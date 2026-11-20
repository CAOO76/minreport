import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { auth } from '../../config/firebase';
import { signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { ThemeSwitch } from '../../components/ThemeSwitch';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import BrandLogo from '../../components/BrandLogo';
import BrandingManager from '../../components/admin/BrandingManager';
import M3LinearProgress from '../../components/common/M3LinearProgress';
import M3CircularProgress from '../../components/common/M3CircularProgress';
import { useMinReportSession } from '../../context/MinReportSessionContext';
import { isGeolappOnlyDevStage } from '../../config/releaseStage';
import { ModuleHost, M3ModuleHudFallback } from '../../core/modules/ModuleHost';
import { getApiUrl } from '../../utils/network';
import {
    clearDevTokensFromStorage,
    evictExpiredDevTokensFromStorage,
    isClientCachedJwtFresh,
} from '../../utils/jwtFreshness';

// Carga asíncrona de bandejas integradas para navegación 100% contenida en cabina DEV
const DevEquipmentOnboardingInbox = lazy(() => import('../../components/dev/DevEquipmentOnboardingInbox').then(m => ({ default: m.DevEquipmentOnboardingInbox })));

type DevAuthState = 'IDLE' | 'OTP' | 'USER' | 'PASSWORD' | 'PASSWORD_ROTATION';

export type DevSection =
    // Configuración MINREPORT
    | 'PILOT_METRICS'
    | 'EQUIPMENT_ONBOARDING'
    | 'BRANDING'
    // Módulos Industriales (CATÁLOGO, FLOTA y SIMBOLOGÍA separados bajo Minimalismo Industrial Puro)
    | 'MODULE_STOCKPILE'
    | 'MODULE_OPERMAQ_CATALOG'
    | 'MODULE_OPERMAQ_FLEET'
    | 'MODULE_OPERMAQ_SYMBOLOGY'
    | 'MODULE_OPERMAQ_MANUFACTURERS'
    | 'MODULE_OPERMAQ_SUPPLIERS';

function formatCountdownMmSs(seconds: number): string {
    const safe = Math.max(0, Math.floor(seconds));
    const mins = String(Math.floor(safe / 60)).padStart(2, '0');
    const secs = String(safe % 60).padStart(2, '0');
    return `${mins}:${secs}`;
}

function formatUtcTimestamp(isoValue: string | null | undefined, fallback: string): string {
    if (!isoValue) return fallback;
    const ms = Date.parse(isoValue);
    if (!Number.isFinite(ms) || ms <= 0) return fallback;
    return `${new Date(ms).toISOString().replace('T', ' ').slice(0, 16)} UTC`;
}

interface DevPilotAggregatedMetrics {
    pilots: {
        total: number;
        active: number;
        expired: number;
        revoked: number;
    };
    sandboxes: {
        pilotTenantsCount: number;
        tenantAssetsCount: number;
        stockpilesCount: number;
    };
    aiInteractions: {
        total: number;
        byModule: {
            core: number;
            opermaq: number;
            geolapp: number;
            stockpile: number;
        };
        byCategory: {
            BUG_CORRECTION: number;
            CHANGE_REQUEST: number;
            AI_KNOWLEDGE_TRAINING: number;
            FIELD_SIMULATION: number;
        };
        byPriority: {
            LOW: number;
            MEDIUM: number;
            HIGH: number;
            CRITICAL: number;
        };
        byStatus: {
            PENDING: number;
            REVIEWED: number;
            APPLIED_TO_AI: number;
            REJECTED: number;
        };
        lastActivityAt: string | null;
    };
}

export const DevVaultGateway: React.FC = () => {
    const { t } = useTranslation();
    const { session, isLoaded } = useMinReportSession();
    const geolappOnlyStage = isGeolappOnlyDevStage();
    const defaultSection: DevSection = geolappOnlyStage ? 'MODULE_STOCKPILE' : 'MODULE_OPERMAQ_CATALOG';
    const [activeSection, setActiveSection] = useState<DevSection>(defaultSection);
    const isModuleSection = activeSection.startsWith('MODULE_');

    // Estado Auth DEV
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
    const [devToken, setDevToken] = useState<string>('');

    // Máquina de estados de acceso Out-of-Band
    const [authState, setAuthState] = useState<DevAuthState>('IDLE');
    const [challengeId, setChallengeId] = useState<string>('');
    const [clientToken, setClientToken] = useState<string>('');
    const [stepToken, setStepToken] = useState<string>('');
    const [expiresAt, setExpiresAt] = useState<number>(0);
    const [timeLeft, setTimeLeft] = useState<number>(600);
    const [attemptsRemaining, setAttemptsRemaining] = useState<number>(3);

    // Campos de entrada escalonados
    const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
    const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
    const [loginEmail, setLoginEmail] = useState<string>('');
    const [loginPassword, setLoginPassword] = useState<string>('');
    const [oldPassword, setOldPassword] = useState<string>('');
    const [newPassword, setNewPassword] = useState<string>('');
    const [confirmPassword, setConfirmPassword] = useState<string>('');
    const [showPassword, setShowPassword] = useState<boolean>(false);
    const [daysRemaining, setDaysRemaining] = useState<number>(30);

    const [loginLoading, setLoginLoading] = useState<boolean>(false);
    const [loginError, setLoginError] = useState<string | null>(null);

    const [pilotMetrics, setPilotMetrics] = useState<DevPilotAggregatedMetrics | null>(null);
    const [pilotMetricsLoading, setPilotMetricsLoading] = useState<boolean>(false);
    const [pilotMetricsError, setPilotMetricsError] = useState<string | null>(null);

    const apiBase = getApiUrl('/api/dev');

    const fetchPilotMetrics = useCallback(async () => {
        setPilotMetricsLoading(true);
        setPilotMetricsError(null);
        try {
            const firebaseToken = await auth.currentUser?.getIdToken().catch(() => null);
            const token =
                firebaseToken ||
                devToken ||
                localStorage.getItem('dev_auth_token') ||
                localStorage.getItem('dev_vault_token') ||
                '';
            const res = await fetch(`${apiBase}/pilot-metrics`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { Authorization: `Bearer ${token}` } : {}),
                },
            });
            const data = await res.json();
            if (!res.ok || !data?.success) {
                throw new Error(data?.error || t('core_dev_vault.pilot_metrics.error_fetch'));
            }
            setPilotMetrics((data.metrics as DevPilotAggregatedMetrics) ?? null);
        } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : t('core_dev_vault.pilot_metrics.error_fetch');
            setPilotMetricsError(msg);
        } finally {
            setPilotMetricsLoading(false);
        }
    }, [apiBase, devToken, t]);

    useEffect(() => {
        if (isAuthenticated && activeSection === 'PILOT_METRICS') {
            void fetchPilotMetrics();
        }
    }, [isAuthenticated, activeSection, fetchPilotMetrics]);

    useEffect(() => {
        const handleOpenCatalogAsset = () => {
            setActiveSection('MODULE_OPERMAQ_CATALOG');
        };
        window.addEventListener('opermaq:open-catalog-asset', handleOpenCatalogAsset);
        return () => window.removeEventListener('opermaq:open-catalog-asset', handleOpenCatalogAsset);
    }, []);

    useEffect(() => {
        window.name = 'minreport_dev_terminal';
        document.title = 'MINREPORT';
        let metaRobots = document.querySelector('meta[name="robots"]');
        if (!metaRobots) {
            metaRobots = document.createElement('meta');
            metaRobots.setAttribute('name', 'robots');
            document.head.appendChild(metaRobots);
        }
        metaRobots.setAttribute('content', 'noindex, nofollow');

        evictExpiredDevTokensFromStorage();
        const savedToken = localStorage.getItem('dev_auth_token') || localStorage.getItem('dev_vault_token');
        const hasFreshSavedToken = isClientCachedJwtFresh(savedToken);

        let cancelled = false;
        (async () => {
            try {
                if (typeof auth.authStateReady === 'function') {
                    await auth.authStateReady();
                }
            } catch {
                // Continuar con evaluación local
            }
            if (cancelled) return;

            const current = auth.currentUser;
            const isDevFirebaseUser =
                Boolean(current) &&
                (current!.uid === 'dev-master-root-uid' ||
                    current!.email?.toLowerCase() === 'dev@minreport.com');

            if (isDevFirebaseUser && current) {
                try {
                    const fresh = await current.getIdToken();
                    if (!cancelled && fresh) {
                        localStorage.setItem('dev_auth_token', fresh);
                        setDevToken(fresh);
                        setIsAuthenticated(true);
                        return;
                    }
                } catch {
                    // Continuar con evaluación de token guardado
                }
            }

            if (hasFreshSavedToken && savedToken) {
                if (!cancelled) {
                    setDevToken(savedToken);
                    setIsAuthenticated(true);
                }
                return;
            }

            clearDevTokensFromStorage();
            if (!cancelled) {
                setDevToken('');
                setIsAuthenticated(false);
            }
        })();

        // Inspeccionar si venimos de error en confirmación desde el email (302 redirect)
        const params = new URLSearchParams(window.location.search);
        const errParam = params.get('error');

        if (errParam) {
            setLoginError(decodeURIComponent(errParam));
            window.history.replaceState({}, document.title, window.location.pathname);
        }

        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        const handleOpenManufacturerChannels = () => {
            setActiveSection('MODULE_OPERMAQ_MANUFACTURERS');
        };
        const handleOpenSupplierAgenda = () => {
            setActiveSection('MODULE_OPERMAQ_SUPPLIERS');
        };
        window.addEventListener('opermaq:open-manufacturer-channels', handleOpenManufacturerChannels);
        window.addEventListener('opermaq:open-supplier-agenda', handleOpenSupplierAgenda);
        return () => {
            window.removeEventListener('opermaq:open-manufacturer-channels', handleOpenManufacturerChannels);
            window.removeEventListener('opermaq:open-supplier-agenda', handleOpenSupplierAgenda);
        };
    }, []);

    // Renovación y sincronización reactiva de credenciales DEV con Firebase Auth
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (
                user &&
                (user.email?.toLowerCase() === 'dev@minreport.com' ||
                    user.uid === 'dev-master-root-uid')
            ) {
                try {
                    const freshToken = await user.getIdToken();
                    setDevToken(freshToken);
                    localStorage.setItem('dev_auth_token', freshToken);
                    setIsAuthenticated(true);
                } catch (err) {
                    console.error('[DEV] Error renovando ID Token de Firebase:', err);
                }
            }
        });
        return () => unsubscribe();
    }, []);

    // Sincronización automática de sesión Firebase Auth en cabina /dev tras recarga con dev_auth_token
    useEffect(() => {
        if (!isAuthenticated) return;
        evictExpiredDevTokensFromStorage();
        const activeToken = devToken || localStorage.getItem('dev_auth_token') || '';
        if (!isClientCachedJwtFresh(activeToken)) {
            const restoredCurrent = auth.currentUser;
            const alreadyDevRoot =
                Boolean(restoredCurrent) &&
                (restoredCurrent!.uid === 'dev-master-root-uid' ||
                    restoredCurrent!.email?.toLowerCase() === 'dev@minreport.com');
            if (!alreadyDevRoot) {
                clearDevTokensFromStorage();
                setDevToken('');
                setIsAuthenticated(false);
            }
            return;
        }

        let cancelled = false;
        (async () => {
            try {
                if (typeof auth.authStateReady === 'function') {
                    await auth.authStateReady();
                }
                if (cancelled) return;

                const restoredCurrent = auth.currentUser;
                const alreadyDevRoot =
                    Boolean(restoredCurrent) &&
                    (restoredCurrent!.uid === 'dev-master-root-uid' ||
                        restoredCurrent!.email?.toLowerCase() === 'dev@minreport.com');

                if (alreadyDevRoot) return;

                const resp = await fetch(`${apiBase}/auth/session-sync`, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${activeToken}`,
                        'Content-Type': 'application/json',
                    },
                });
                if (resp.status === 401 || resp.status === 403) {
                    if (!cancelled) {
                        clearDevTokensFromStorage();
                        setDevToken('');
                        setIsAuthenticated(false);
                    }
                    return;
                }
                if (!resp.ok || cancelled) return;
                const data = await resp.json().catch(() => ({}));
                if (data?.firebaseToken && !cancelled) {
                    const cred = await signInWithCustomToken(auth, String(data.firebaseToken));
                    const freshIdToken = await cred.user.getIdToken(true);
                    if (!cancelled) {
                        localStorage.setItem('dev_auth_token', freshIdToken);
                        setDevToken(freshIdToken);
                    }
                }
            } catch {
                // Silencioso: authFetch mantiene respaldo Bearer dev_auth_token
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [isAuthenticated, devToken, apiBase]);

    // Reloj de cuenta regresiva de 600s (10 minutos)
    useEffect(() => {
        if (authState === 'IDLE') return;

        const timer = setInterval(() => {
            const diff = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
            setTimeLeft(diff);

            if (diff <= 0) {
                clearInterval(timer);
                setAuthState('IDLE');
                setLoginError(t('core_dev_vault.auth.session_expired_180'));
                setOtpDigits(['', '', '', '', '', '']);
            }
        }, 1000);

        return () => clearInterval(timer);
    }, [authState, expiresAt, t]);

    // Fase 1: Clic en Isotipo para iniciar reto
    const handleInitChallenge = async () => {
        if (loginLoading || authState !== 'IDLE') return;
        setLoginError(null);
        setLoginLoading(true);

        try {
            const resp = await fetch(`${apiBase}/auth/challenge/init`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });

            const data = await resp.json();
            if (!resp.ok) {
                throw new Error(data.error || t('core_dev_vault.auth.challenge_init_failed'));
            }

            setChallengeId(data.challengeId);
            setClientToken(data.clientToken);
            setExpiresAt(data.expiresAt);
            setTimeLeft(600);
            setAttemptsRemaining(3);
            setOtpDigits(['', '', '', '', '', '']);
            // Transición directa y fluida a OTP en la misma pantalla (cero nuevas pestañas ni parpadeos)
            setAuthState('OTP');
            setTimeout(() => {
                otpRefs.current[0]?.focus();
            }, 100);
        } catch (err: any) {
            setLoginError(err.message || t('core_dev_vault.auth.challenge_start_error'));
        } finally {
            setLoginLoading(false);
        }
    };

    // Manejo de Casilleros OTP
    const handleOtpChange = (index: number, val: string) => {
        const cleaned = val.replace(/\D/g, '');
        const digit = cleaned ? cleaned.slice(-1) : '';

        const newDigits = [...otpDigits];
        newDigits[index] = digit;
        setOtpDigits(newDigits);

        if (digit && index < 5) {
            otpRefs.current[index + 1]?.focus();
        }

        const fullOtp = newDigits.join('');
        if (fullOtp.length === 6 && !newDigits.includes('')) {
            handleVerifyOtp(fullOtp);
        }
    };

    const handleOtpKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
            otpRefs.current[index - 1]?.focus();
        }
    };

    const handleOtpPaste = (e: React.ClipboardEvent) => {
        e.preventDefault();
        const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
        if (pasted.length > 0) {
            const newDigits = [...otpDigits];
            for (let i = 0; i < 6; i++) {
                newDigits[i] = pasted[i] || '';
            }
            setOtpDigits(newDigits);
            if (pasted.length === 6) {
                handleVerifyOtp(pasted);
            } else {
                otpRefs.current[pasted.length]?.focus();
            }
        }
    };

    // Fase 2: Verificación física del código OTP
    const handleVerifyOtp = async (code: string) => {
        setLoginError(null);
        setLoginLoading(true);

        try {
            const resp = await fetch(`${apiBase}/auth/challenge/verify-otp`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    challengeId,
                    clientToken,
                    otp: code
                })
            });

            const data = await resp.json();
            if (!resp.ok) {
                if (data.attemptsRemaining <= 0) {
                    setAuthState('IDLE');
                    setLoginError(t('core_dev_vault.auth.otp_attempts_exceeded'));
                    setOtpDigits(['', '', '', '', '', '']);
                } else {
                    setLoginError(t('core_dev_vault.auth.otp_invalid_remaining', { count: data.attemptsRemaining }));
                    setAttemptsRemaining(data.attemptsRemaining);
                    setOtpDigits(['', '', '', '', '', '']);
                    otpRefs.current[0]?.focus();
                }
                return;
            }

            setStepToken(data.stepToken);
            setAuthState('USER');
        } catch (err: any) {
            setLoginError(err.message || t('core_dev_vault.auth.otp_validation_error'));
        } finally {
            setLoginLoading(false);
        }
    };

    // Fase 3: Verificación de Usuario DEV y chequeo de rotación de clave
    const handleVerifyUser = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoginError(null);
        setLoginLoading(true);

        try {
            const cleanUser = loginEmail.trim().toLowerCase();
            const resp = await fetch(`${apiBase}/auth/challenge/verify-user`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    challengeId,
                    clientToken,
                    stepToken,
                    username: cleanUser
                })
            });

            const data = await resp.json();
            if (!resp.ok) {
                throw new Error(data.error || t('core_dev_vault.auth.identity_unauthorized'));
            }

            setDaysRemaining(data.daysRemaining);
            if (data.requiresPasswordRotation) {
                setAuthState('PASSWORD_ROTATION');
            } else {
                setAuthState('PASSWORD');
            }
        } catch (err: any) {
            setLoginError(err.message || t('core_dev_vault.auth.identity_unauthorized'));
        } finally {
            setLoginLoading(false);
        }
    };

    // Fase 4: Autenticación final con Clave (o rotación si venció)
    const handleLoginFinal = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoginError(null);
        setLoginLoading(true);

        try {
            if (authState === 'PASSWORD_ROTATION') {
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

            const payload: any = {
                challengeId,
                clientToken,
                stepToken,
                username: loginEmail.trim().toLowerCase(),
                password: authState === 'PASSWORD_ROTATION' ? oldPassword : loginPassword
            };

            if (authState === 'PASSWORD_ROTATION') {
                payload.newPassword = newPassword.trim();
            }

            const resp = await fetch(`${apiBase}/auth/challenge/login-final`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            const data = await resp.json();
            if (!resp.ok) {
                throw new Error(data.error || t('core_dev_vault.auth.invalid_credentials'));
            }

            let effectiveToken = data.token || data.firebaseToken;
            if (data.firebaseToken) {
                try {
                    const cred = await signInWithCustomToken(auth, data.firebaseToken);
                    effectiveToken = await cred.user.getIdToken(true);
                } catch (fbErr) {
                    console.warn('[DEV] Firebase sync warning:', fbErr);
                }
            }

            localStorage.setItem('dev_auth_token', effectiveToken);
            setDevToken(effectiveToken);
            setIsAuthenticated(true);
        } catch (err: any) {
            setLoginError(err.message || t('core_dev_vault.auth.auth_failed'));
        } finally {
            setLoginLoading(false);
        }
    };

    const handleAbortChallenge = () => {
        setAuthState('IDLE');
        setChallengeId('');
        setClientToken('');
        setStepToken('');
        setOtpDigits(['', '', '', '', '', '']);
        setLoginError(null);
    };

    const handleLogout = async () => {
        localStorage.removeItem('dev_auth_token');
        localStorage.removeItem('dev_vault_token');
        setDevToken('');
        setLoginEmail('');
        setLoginPassword('');
        setOldPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setAuthState('IDLE');
        setIsAuthenticated(false);
        try {
            await auth.signOut();
        } catch { }
    };

    // Restriccion Soberana: /dev es exclusivo para 1º DEV (isDevRoot)
    if (isLoaded && session && !session.isDevRoot) {
        if (session.isSuperAdmin) {
            return <Navigate to="/admin" replace />;
        }
        if (session.isTestPilot) {
            return <Navigate to="/pilot" replace />;
        }
        return <Navigate to="/dashboard" replace />;
    }

    // =========================================================================
    // VISTA 1: ACCESO DEV SILENCIOSO & DESAFÍO PROGRESSIVO (MINIMALISMO ABSOLUTO)
    // =========================================================================
    if (!isAuthenticated) {
        return (
            <div className="min-h-screen bg-white dark:bg-[#000000] text-slate-900 dark:text-[#F3F4F6] flex flex-col items-center justify-center p-6 antialiased select-none font-sans relative">

                {/* Controles Flotantes Superior */}
                <div className="absolute top-6 right-6 flex items-center gap-fib-8 z-50">
                    <LanguageSwitch />
                    <ThemeSwitch />
                </div>

                {/* ESTADO 0: SILENCIO ABSOLUTO (ÚNICAMENTE EL IMAGOTIPO VERTICAL COMO BOTÓN INTERACTIVO) */}
                {authState === 'IDLE' && (
                    <div className="flex flex-col items-center justify-center max-w-md text-center">
                        <button
                            type="button"
                            onClick={handleInitChallenge}
                            disabled={loginLoading}
                            aria-label={t('core_dev_vault.auth.init_challenge_aria')}
                            className="bg-transparent border-0 outline-none p-4 cursor-pointer transition-transform duration-300 hover:scale-105 active:scale-95 disabled:opacity-50"
                        >
                            <BrandLogo variant="imagotypeVertical" className="h-36 w-auto object-contain pointer-events-none" />
                        </button>

                        {loginError && (
                            <div className="mt-6 p-fib-13 text-data-dense font-mono text-red-500 border border-red-500/20 bg-red-500/5 rounded-none max-w-sm text-center">
                                {loginError}
                            </div>
                        )}
                    </div>
                )}

                {/* ESTADOS CON CAMPOS HABILITADOS */}
                {(authState === 'OTP' || authState === 'USER' || authState === 'PASSWORD' || authState === 'PASSWORD_ROTATION') && (
                    <div className="w-full max-w-md mx-auto space-y-6">

                        {/* Cabecera Discreta */}
                        <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#12151C] pb-3">
                            <div className="flex items-center gap-2">
                                <BrandLogo variant="isotype" className="h-6 w-auto object-contain" />
                            </div>
                            <span className="font-mono text-data-dense text-[#475569] dark:text-[#9CA3AF] tabular-nums">
                                {t('core_dev_vault.auth.time_remaining_mmss', { time: formatCountdownMmSs(timeLeft) })}
                            </span>
                        </div>

                        {loginError && (
                            <div className="p-fib-13 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-data-dense font-mono rounded-none">
                                {loginError}
                            </div>
                        )}

                        {/* SUB-ESTADO: OTP */}
                        {authState === 'OTP' && (
                            <div className="bg-[#F8FAFC] dark:bg-[#07090D] border border-slate-200 dark:border-[#12151C] p-6 rounded-none space-y-6">
                                <div className="flex justify-center">
                                    <span className="material-symbols-outlined text-[#C68346] text-2xl select-none">
                                        mark_email_read
                                    </span>
                                </div>

                                <div className="flex justify-between gap-2" onPaste={handleOtpPaste}>
                                    {otpDigits.map((digit, idx) => (
                                        <div key={idx}>
                                            <label htmlFor={`dev-otp-digit-${idx}`} className="sr-only">
                                                {t('core_dev_vault.auth.otp_digit_label', { index: idx + 1 })}
                                            </label>
                                            <input
                                                id={`dev-otp-digit-${idx}`}
                                                ref={el => { otpRefs.current[idx] = el; }}
                                                type="text"
                                                inputMode="numeric"
                                                maxLength={1}
                                                aria-label={t('core_dev_vault.auth.otp_digit_label', { index: idx + 1 })}
                                                value={digit}
                                                onChange={e => handleOtpChange(idx, e.target.value)}
                                                onKeyDown={e => handleOtpKeyDown(idx, e)}
                                                onPaste={handleOtpPaste}
                                                autoComplete="off"
                                                spellCheck={false}
                                                className="min-w-[48px] min-h-[56px] w-12 h-14 bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#12151C] focus:border-[#C68346] text-slate-900 dark:text-[#F3F4F6] text-center text-2xl font-mono tabular-nums font-bold rounded-none outline-none transition-colors"
                                            />
                                        </div>
                                    ))}
                                </div>

                                <div className="flex justify-between items-center text-data-dense font-mono text-[#475569] dark:text-[#9CA3AF]">
                                    <span className="tabular-nums font-mono">{attemptsRemaining}/3</span>
                                    <button
                                        type="button"
                                        onClick={handleAbortChallenge}
                                        className="min-w-[48px] min-h-[48px] flex items-center justify-center bg-transparent border-0 outline-none p-2 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                        title={t('core_dev_vault.common.cancel')}
                                        aria-label={t('core_dev_vault.common.cancel')}
                                    >
                                        <span className="material-symbols-outlined text-[20px]">close</span>
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* SUB-ESTADO: USUARIO */}
                        {authState === 'USER' && (
                            <div className="bg-[#F8FAFC] dark:bg-[#07090D] border border-slate-200 dark:border-[#12151C] p-6 rounded-none space-y-4">
                                <form onSubmit={handleVerifyUser} autoComplete="off" spellCheck={false} className="space-y-4">
                                    <div>
                                        <label
                                            htmlFor="dev-login-email"
                                            className="sr-only"
                                        >
                                            {t('core_dev_vault.auth.user_id_label')}
                                        </label>
                                        <div className="relative flex items-center">
                                            <span className="material-symbols-outlined absolute left-3 text-slate-400 dark:text-[#8A93A6] text-[20px] select-none pointer-events-none">
                                                person
                                            </span>
                                            <input
                                                id="dev-login-email"
                                                type="text"
                                                inputMode="email"
                                                aria-label={t('core_dev_vault.auth.user_id_label')}
                                                value={loginEmail}
                                                onChange={e => setLoginEmail(e.target.value)}
                                                required
                                                autoFocus
                                                autoComplete="off"
                                                spellCheck={false}
                                                placeholder=""
                                                className="w-full min-h-[52px] bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#12151C] focus:border-[#C68346] text-slate-900 dark:text-[#F3F4F6] pl-11 pr-3 py-3 text-body-main font-mono outline-none rounded-none transition-colors"
                                            />
                                        </div>
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={loginLoading}
                                        title={t('core_dev_vault.auth.verify_user_btn')}
                                        aria-label={t('core_dev_vault.auth.verify_user_btn')}
                                        className="w-full min-h-[52px] py-3 bg-[#C68346] hover:bg-[#b0743e] text-white font-mono font-bold text-data-dense uppercase tracking-wider transition-colors disabled:opacity-50 cursor-pointer rounded-none outline-none flex items-center justify-center"
                                    >
                                        {loginLoading ? (
                                            <M3CircularProgress size={18} strokeWidth={3} ariaLabel={t('core_dev_vault.auth.processing')} />
                                        ) : (
                                            <span className="material-symbols-outlined text-[22px]">arrow_forward</span>
                                        )}
                                    </button>
                                </form>
                            </div>
                        )}

                        {/* SUB-ESTADO: CLAVE TRADICIONAL */}
                        {authState === 'PASSWORD' && (
                            <div className="bg-[#F8FAFC] dark:bg-[#07090D] border border-slate-200 dark:border-[#12151C] p-6 rounded-none space-y-4">
                                <form onSubmit={handleLoginFinal} autoComplete="off" spellCheck={false} className="space-y-4">
                                    <div>
                                        <label
                                            htmlFor="dev-login-password"
                                            className="sr-only"
                                        >
                                            {t('core_dev_vault.auth.password_label')}
                                        </label>
                                        <div className="relative flex items-center">
                                            <span className="material-symbols-outlined absolute left-3 text-slate-400 dark:text-[#8A93A6] text-[20px] select-none pointer-events-none">
                                                key
                                            </span>
                                            <input
                                                id="dev-login-password"
                                                type={showPassword ? 'text' : 'password'}
                                                aria-label={t('core_dev_vault.auth.password_label')}
                                                value={loginPassword}
                                                onChange={e => setLoginPassword(e.target.value)}
                                                required
                                                autoFocus
                                                autoComplete="off"
                                                spellCheck={false}
                                                placeholder=""
                                                className="w-full min-h-[52px] bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#12151C] focus:border-[#C68346] text-slate-900 dark:text-[#F3F4F6] pl-11 pr-12 py-3 text-body-main font-mono outline-none rounded-none transition-colors"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowPassword(prev => !prev)}
                                                title={showPassword ? t('core_dev_vault.auth.hide_key') : t('core_dev_vault.auth.show_key')}
                                                aria-label={showPassword ? t('core_dev_vault.auth.hide_key') : t('core_dev_vault.auth.show_key')}
                                                className="min-w-[48px] min-h-[48px] absolute right-0 bg-transparent border-0 outline-none p-2 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer flex items-center justify-center"
                                            >
                                                <span className="material-symbols-outlined text-[20px] select-none">
                                                    {showPassword ? 'visibility_off' : 'visibility'}
                                                </span>
                                            </button>
                                        </div>
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={loginLoading}
                                        title={t('core_dev_vault.auth.unlock_btn')}
                                        aria-label={t('core_dev_vault.auth.unlock_btn')}
                                        className="w-full min-h-[52px] py-3 bg-[#C68346] hover:bg-[#b0743e] text-white font-mono font-bold text-data-dense uppercase tracking-wider transition-colors disabled:opacity-50 cursor-pointer rounded-none outline-none flex items-center justify-center"
                                    >
                                        {loginLoading ? (
                                            <M3CircularProgress size={18} strokeWidth={3} ariaLabel={t('core_dev_vault.auth.processing')} />
                                        ) : (
                                            <span className="material-symbols-outlined text-[22px]">lock_open</span>
                                        )}
                                    </button>
                                </form>
                            </div>
                        )}

                        {/* SUB-ESTADO: ROTACIÓN DE CLAVE */}
                        {authState === 'PASSWORD_ROTATION' && (
                            <div className="bg-[#F8FAFC] dark:bg-[#07090D] border border-[#C68346]/40 p-6 rounded-none space-y-4">
                                <div className="flex justify-between items-center py-1">
                                    <span className="material-symbols-outlined text-[#C68346] text-2xl select-none">
                                        lock_reset
                                    </span>
                                    <span className="text-data-dense font-mono tabular-nums text-slate-500 dark:text-[#9CA3AF]">
                                        {t('core_dev_vault.auth.days_remaining', { days: daysRemaining })}
                                    </span>
                                </div>

                                <form onSubmit={handleLoginFinal} autoComplete="off" spellCheck={false} className="space-y-4">
                                    <div>
                                        <label
                                            htmlFor="dev-old-password"
                                            className="sr-only"
                                        >
                                            {t('core_dev_vault.auth.current_key_label')}
                                        </label>
                                        <div className="relative flex items-center">
                                            <span className="material-symbols-outlined absolute left-3 text-slate-400 dark:text-[#8A93A6] text-[20px] select-none pointer-events-none">
                                                key
                                            </span>
                                            <input
                                                id="dev-old-password"
                                                type={showPassword ? 'text' : 'password'}
                                                aria-label={t('core_dev_vault.auth.current_key_label')}
                                                value={oldPassword}
                                                onChange={e => setOldPassword(e.target.value)}
                                                required
                                                autoFocus
                                                autoComplete="off"
                                                spellCheck={false}
                                                placeholder=""
                                                className="w-full min-h-[52px] bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#12151C] focus:border-[#C68346] text-slate-900 dark:text-[#F3F4F6] pl-11 pr-12 py-3 text-body-main font-mono outline-none rounded-none transition-colors"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => setShowPassword(prev => !prev)}
                                                title={showPassword ? t('core_dev_vault.auth.hide_key') : t('core_dev_vault.auth.show_key')}
                                                aria-label={showPassword ? t('core_dev_vault.auth.hide_key') : t('core_dev_vault.auth.show_key')}
                                                className="min-w-[48px] min-h-[48px] absolute right-0 bg-transparent border-0 outline-none p-2 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer flex items-center justify-center"
                                            >
                                                <span className="material-symbols-outlined text-[20px] select-none">
                                                    {showPassword ? 'visibility_off' : 'visibility'}
                                                </span>
                                            </button>
                                        </div>
                                    </div>

                                    <div>
                                        <label
                                            htmlFor="dev-new-password"
                                            className="sr-only"
                                        >
                                            {t('core_dev_vault.auth.new_key_label')}
                                        </label>
                                        <div className="relative flex items-center">
                                            <span className="material-symbols-outlined absolute left-3 text-slate-400 dark:text-[#8A93A6] text-[20px] select-none pointer-events-none">
                                                lock
                                            </span>
                                            <input
                                                id="dev-new-password"
                                                type={showPassword ? 'text' : 'password'}
                                                aria-label={t('core_dev_vault.auth.new_key_label')}
                                                value={newPassword}
                                                onChange={e => setNewPassword(e.target.value)}
                                                required
                                                minLength={8}
                                                autoComplete="off"
                                                spellCheck={false}
                                                placeholder=""
                                                className="w-full min-h-[52px] bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#12151C] focus:border-[#C68346] text-slate-900 dark:text-[#F3F4F6] pl-11 pr-3 py-3 text-body-main font-mono outline-none rounded-none transition-colors"
                                            />
                                        </div>
                                    </div>

                                    <div>
                                        <label
                                            htmlFor="dev-confirm-password"
                                            className="sr-only"
                                        >
                                            {t('core_dev_vault.auth.confirm_new_key_label')}
                                        </label>
                                        <div className="relative flex items-center">
                                            <span className="material-symbols-outlined absolute left-3 text-slate-400 dark:text-[#8A93A6] text-[20px] select-none pointer-events-none">
                                                verified_user
                                            </span>
                                            <input
                                                id="dev-confirm-password"
                                                type={showPassword ? 'text' : 'password'}
                                                aria-label={t('core_dev_vault.auth.confirm_new_key_label')}
                                                value={confirmPassword}
                                                onChange={e => setConfirmPassword(e.target.value)}
                                                required
                                                minLength={8}
                                                autoComplete="off"
                                                spellCheck={false}
                                                placeholder=""
                                                className="w-full min-h-[52px] bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#12151C] focus:border-[#C68346] text-slate-900 dark:text-[#F3F4F6] pl-11 pr-3 py-3 text-body-main font-mono outline-none rounded-none transition-colors"
                                            />
                                        </div>
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={loginLoading}
                                        title={t('core_dev_vault.auth.rotate_and_unlock_btn')}
                                        aria-label={t('core_dev_vault.auth.rotate_and_unlock_btn')}
                                        className="w-full min-h-[52px] py-3 bg-[#C68346] hover:bg-[#b0743e] text-white font-mono font-bold text-data-dense uppercase tracking-wider transition-colors disabled:opacity-50 cursor-pointer rounded-none outline-none flex items-center justify-center"
                                    >
                                        {loginLoading ? (
                                            <M3CircularProgress size={18} strokeWidth={3} ariaLabel={t('core_dev_vault.auth.processing')} />
                                        ) : (
                                            <span className="material-symbols-outlined text-[22px]">sync</span>
                                        )}
                                    </button>
                                </form>
                            </div>
                        )}

                    </div>
                )}

            </div>
        );
    }


    // =========================================================================
    // VISTA 2: PANEL DE CONTROL DEV (MINIMALISMO INDUSTRIAL PURO)
    // =========================================================================
    return (
        <div className="h-screen bg-white dark:bg-[#000000] text-slate-900 dark:text-[#F3F4F6] flex flex-col font-sans select-none antialiased overflow-hidden">

            {/* =========================================================================
                BARRA DE NAVEGACIÓN SUPERIOR (LOGOTIPO CORPORATIVO + MODO, IDIOMA Y SALIR)
                ========================================================================= */}
            <header className="h-14 px-[21px] border-b border-slate-200 dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] flex items-center justify-between shrink-0 z-50">
                <button
                    type="button"
                    onClick={() => setActiveSection(defaultSection)}
                    title={t('core_dev_vault.nav.back_to_main')}
                    aria-label={t('core_dev_vault.nav.back_to_main')}
                    className="min-h-[48px] bg-transparent border-0 outline-none p-0 cursor-pointer flex items-center"
                >
                    <BrandLogo variant="logotype" className="h-6 w-auto object-contain pointer-events-none" />
                </button>

                <div className="flex items-center gap-[13px]">
                    <ThemeSwitch />
                    <LanguageSwitch />
                    <button
                        type="button"
                        onClick={handleLogout}
                        title={t('core_dev_vault.nav.logout')}
                        aria-label={t('core_dev_vault.nav.logout')}
                        className="min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none p-2 text-slate-400 hover:text-red-500 transition-colors cursor-pointer flex items-center justify-center rounded-none"
                    >
                        <span className="material-symbols-outlined text-[20px]">logout</span>
                    </button>
                </div>
            </header>

            {/* =========================================================================
                CONTENEDOR INFERIOR: COLUMNA DE MENÚ + ÁREA DE TRABAJO PRINCIPAL
                ========================================================================= */}
            <div className="flex flex-1 min-h-0 overflow-hidden relative">
                <aside className="w-16 h-full flex flex-col items-center py-4 border-r border-slate-200 dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] z-40 relative select-none shrink-0">

                    {/* CABECERA COLUMNA MENÚ: ISOTIPO OFICIAL */}
                    <button
                        type="button"
                        onClick={() => setActiveSection(defaultSection)}
                        title={t('core_dev_vault.nav.back_to_main')}
                        aria-label={t('core_dev_vault.nav.back_to_main')}
                        className="mb-3 min-w-[48px] min-h-[48px] bg-transparent border-0 outline-none p-1 cursor-pointer flex items-center justify-center rounded-none shadow-none"
                    >
                        <BrandLogo variant="isotype" className="h-6 w-6 object-contain pointer-events-none" />
                    </button>

                    <div className="w-7 h-[1px] bg-[#CBD5E1] dark:bg-[#5A6072]/50 mb-[8px] shrink-0" />

                    {/* GRUPO 1: CONFIGURAR MINREPORT (BOTONES PLANOS TRANSPARENTES) */}
                    <div className="flex flex-col items-center gap-1 w-full">
                        {!geolappOnlyStage && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => setActiveSection('PILOT_METRICS')}
                                    title={t('core_dev_vault.nav.pilot_metrics_title')}
                                    aria-label={t('core_dev_vault.nav.pilot_metrics_aria')}
                                    className={`group min-w-[48px] min-h-[48px] w-full py-2.5 bg-transparent border-0 outline-none transition-colors cursor-pointer rounded-none relative flex items-center justify-center ${activeSection === 'PILOT_METRICS'
                                        ? 'text-[#C68346]'
                                        : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                        }`}
                                >
                                    {activeSection === 'PILOT_METRICS' && (
                                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-[#C68346]" />
                                    )}
                                    <span className="material-symbols-outlined text-[22px]">monitoring</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => setActiveSection('EQUIPMENT_ONBOARDING')}
                                    title={t('core_dev_vault.nav.eq_onboarding_title')}
                                    aria-label={t('core_dev_vault.nav.eq_onboarding_title')}
                                    className={`min-w-[48px] min-h-[48px] w-full py-2.5 bg-transparent border-0 outline-none transition-colors cursor-pointer rounded-none relative flex items-center justify-center ${activeSection === 'EQUIPMENT_ONBOARDING'
                                        ? 'text-[#C68346]'
                                        : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                        }`}
                                >
                                    {activeSection === 'EQUIPMENT_ONBOARDING' && (
                                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-[#C68346]" />
                                    )}
                                    <span className="material-symbols-outlined text-[22px]">precision_manufacturing</span>
                                </button>
                            </>
                        )}

                        <button
                            type="button"
                            onClick={() => setActiveSection('BRANDING')}
                            title={t('core_dev_vault.nav.branding_title')}
                            aria-label={t('core_dev_vault.nav.branding_aria')}
                            className={`min-w-[48px] min-h-[48px] w-full py-2.5 bg-transparent border-0 outline-none transition-colors cursor-pointer rounded-none relative flex items-center justify-center ${activeSection === 'BRANDING'
                                ? 'text-[#C68346]'
                                : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                        >
                            {activeSection === 'BRANDING' && (
                                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-[#C68346]" />
                            )}
                            <span className="material-symbols-outlined text-[22px]">palette</span>
                        </button>
                    </div>

                    {/* SEPARADOR DE PRECISIÓN FIBONACCI */}
                    <div className="w-7 h-[1px] bg-[#CBD5E1] dark:bg-[#5A6072]/50 my-[13px] shrink-0" />

                    {/* GRUPO 2: MÓDULO GEOLAPP® · STOCKPILE CONTROL */}
                    <div className="flex flex-col items-center gap-1 w-full">
                        <button
                            type="button"
                            onClick={() => setActiveSection('MODULE_STOCKPILE')}
                            title={t('core_dev_vault.nav.stockpile_title')}
                            aria-label={t('core_dev_vault.nav.stockpile_aria')}
                            className={`min-w-[48px] min-h-[48px] w-full py-2.5 bg-transparent border-0 outline-none transition-colors cursor-pointer rounded-none relative flex items-center justify-center ${activeSection === 'MODULE_STOCKPILE'
                                ? 'text-[#C68346]'
                                : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                }`}
                        >
                            {activeSection === 'MODULE_STOCKPILE' && (
                                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-[#C68346]" />
                            )}
                            <span className="material-symbols-outlined text-[22px]">layers</span>
                        </button>
                    </div>

                    {!geolappOnlyStage && (
                        <>
                            {/* SEPARADOR DE PRECISIÓN FIBONACCI — MÓDULO OPERMAQ */}
                            <div className="w-7 h-[1px] bg-[#CBD5E1] dark:bg-[#5A6072]/50 my-[13px] shrink-0" />

                            {/* GRUPO 3: MÓDULO OPERMAQ (CATÁLOGO, FLOTA & SIMBOLOGÍA TRANSVERSAL) */}
                            <div className="flex flex-col items-center gap-1 w-full">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setActiveSection('MODULE_OPERMAQ_CATALOG');
                                        window.dispatchEvent(new CustomEvent('opermaq:navigate-home'));
                                    }}
                                    title={t('core_dev_vault.nav.catalog_title')}
                                    aria-label={t('core_dev_vault.nav.catalog_aria')}
                                    className={`group min-w-[48px] min-h-[48px] w-full py-2.5 bg-transparent border-0 outline-none transition-colors cursor-pointer rounded-none relative flex items-center justify-center ${activeSection === 'MODULE_OPERMAQ_CATALOG'
                                        ? 'text-[#C68346]'
                                        : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                        }`}
                                >
                                    {activeSection === 'MODULE_OPERMAQ_CATALOG' && (
                                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-[#C68346]" />
                                    )}
                                    <span className="material-symbols-outlined text-[22px]">front_loader</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => {
                                        setActiveSection('MODULE_OPERMAQ_FLEET');
                                        window.dispatchEvent(new CustomEvent('opermaq:navigate-home'));
                                    }}
                                    title={t('core_dev_vault.nav.fleet_title')}
                                    aria-label={t('core_dev_vault.nav.fleet_aria')}
                                    className={`min-w-[48px] min-h-[48px] w-full py-2.5 bg-transparent border-0 outline-none transition-colors cursor-pointer rounded-none relative flex items-center justify-center ${activeSection === 'MODULE_OPERMAQ_FLEET'
                                        ? 'text-[#C68346]'
                                        : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                        }`}
                                >
                                    {activeSection === 'MODULE_OPERMAQ_FLEET' && (
                                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-[#C68346]" />
                                    )}
                                    <span className="material-symbols-outlined text-[22px]">lists</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => {
                                        setActiveSection('MODULE_OPERMAQ_SYMBOLOGY');
                                        window.dispatchEvent(new CustomEvent('opermaq:navigate-home'));
                                    }}
                                    title={t('core_dev_vault.nav.symbology_title')}
                                    aria-label={t('core_dev_vault.nav.symbology_aria')}
                                    className={`min-w-[48px] min-h-[48px] w-full py-2.5 bg-transparent border-0 outline-none transition-colors cursor-pointer rounded-none relative flex items-center justify-center ${activeSection === 'MODULE_OPERMAQ_SYMBOLOGY'
                                        ? 'text-[#C68346]'
                                        : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                        }`}
                                >
                                    {activeSection === 'MODULE_OPERMAQ_SYMBOLOGY' && (
                                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-[#C68346]" />
                                    )}
                                    <span className="material-symbols-outlined text-[22px]">shapes</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => {
                                        setActiveSection('MODULE_OPERMAQ_MANUFACTURERS');
                                        window.dispatchEvent(new CustomEvent('opermaq:navigate-home'));
                                    }}
                                    title={t('core_dev_vault.nav.manufacturers_title')}
                                    aria-label={t('core_dev_vault.nav.manufacturers_aria')}
                                    className={`min-w-[48px] min-h-[48px] w-full py-2.5 bg-transparent border-0 outline-none transition-colors cursor-pointer rounded-none relative flex items-center justify-center ${activeSection === 'MODULE_OPERMAQ_MANUFACTURERS'
                                        ? 'text-[#C68346]'
                                        : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                        }`}
                                >
                                    {activeSection === 'MODULE_OPERMAQ_MANUFACTURERS' && (
                                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-[#C68346]" />
                                    )}
                                    <span className="material-symbols-outlined text-[22px]">factory</span>
                                </button>

                                <button
                                    type="button"
                                    onClick={() => {
                                        setActiveSection('MODULE_OPERMAQ_SUPPLIERS');
                                        window.dispatchEvent(new CustomEvent('opermaq:navigate-home'));
                                    }}
                                    title={t('core_dev_vault.nav.suppliers_title')}
                                    aria-label={t('core_dev_vault.nav.suppliers_aria')}
                                    className={`min-w-[48px] min-h-[48px] w-full py-2.5 bg-transparent border-0 outline-none transition-colors cursor-pointer rounded-none relative flex items-center justify-center ${activeSection === 'MODULE_OPERMAQ_SUPPLIERS'
                                        ? 'text-[#C68346]'
                                        : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
                                        }`}
                                >
                                    {activeSection === 'MODULE_OPERMAQ_SUPPLIERS' && (
                                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-[#C68346]" />
                                    )}
                                    <span className="material-symbols-outlined text-[22px]">storefront</span>
                                </button>
                            </div>
                        </>
                    )}
                </aside>

                {/* =========================================================================
                    ÁREA DE TRABAJO PRINCIPAL (VISTA ACTIVA)
                    ========================================================================= */}
                <main className="flex-1 h-full min-h-0 p-0 overflow-hidden flex flex-col">
                    <div className={`flex-1 min-h-0 flex flex-col ${isModuleSection ? 'overflow-hidden' : 'p-fib-34 overflow-y-auto'}`}>

                        {/* Header Técnico Aséptico Superior (Oculto en módulos para visualización integrada a pantalla completa) */}
                        {!isModuleSection && (
                            <div className="mb-[21px] border-b border-slate-200 dark:border-[#12151C] pb-[13px] flex justify-between items-end">
                                <div>
                                    <h1 className="text-lg font-bold tracking-tight uppercase font-sans text-slate-900 dark:text-[#F3F4F6]">
                                        {activeSection === 'PILOT_METRICS' && t('core_dev_vault.sections.pilot_metrics')}
                                        {activeSection === 'EQUIPMENT_ONBOARDING' && t('core_dev_vault.sections.equipment_onboarding')}
                                        {activeSection === 'BRANDING' && t('core_dev_vault.sections.branding')}
                                    </h1>
                                </div>
                            </div>
                        )}

                        {/* CONTENIDO 1: MONITOREO PASIVO DE MÉTRICAS TEST-PILOT (SOLO LECTURA) */}
                        {activeSection === 'PILOT_METRICS' && (() => {
                            const aiTotal = pilotMetrics?.aiInteractions.total ?? 0;
                            const pctOf = (count: number) => (aiTotal > 0 ? Math.round((count / aiTotal) * 100) : 0);
                            const lastActivityText = formatUtcTimestamp(
                                pilotMetrics?.aiInteractions.lastActivityAt,
                                t('core_dev_vault.pilot_metrics.pending_record')
                            );
                            const moduleRows = [
                                { key: 'geolapp', label: t('core_dev_vault.pilot_metrics.mod_geolapp'), count: pilotMetrics?.aiInteractions.byModule.geolapp ?? 0 },
                                { key: 'opermaq', label: t('core_dev_vault.pilot_metrics.mod_opermaq'), count: pilotMetrics?.aiInteractions.byModule.opermaq ?? 0 },
                                { key: 'core', label: t('core_dev_vault.pilot_metrics.mod_core'), count: pilotMetrics?.aiInteractions.byModule.core ?? 0 },
                                { key: 'stockpile', label: t('core_dev_vault.pilot_metrics.mod_stockpile'), count: pilotMetrics?.aiInteractions.byModule.stockpile ?? 0 },
                            ];
                            const categoryRows = [
                                { key: 'BUG_CORRECTION', label: t('core_dev_vault.pilot_metrics.cat_bug'), count: pilotMetrics?.aiInteractions.byCategory.BUG_CORRECTION ?? 0 },
                                { key: 'CHANGE_REQUEST', label: t('core_dev_vault.pilot_metrics.cat_change'), count: pilotMetrics?.aiInteractions.byCategory.CHANGE_REQUEST ?? 0 },
                                { key: 'AI_KNOWLEDGE_TRAINING', label: t('core_dev_vault.pilot_metrics.cat_training'), count: pilotMetrics?.aiInteractions.byCategory.AI_KNOWLEDGE_TRAINING ?? 0 },
                                { key: 'FIELD_SIMULATION', label: t('core_dev_vault.pilot_metrics.cat_simulation'), count: pilotMetrics?.aiInteractions.byCategory.FIELD_SIMULATION ?? 0 },
                            ];

                            return (
                                <div className="space-y-[21px]">
                                    <div className="border border-slate-200 dark:border-[#12151C] p-[34px] rounded-none bg-[#F8FAFC] dark:bg-[#07090D] shadow-none space-y-[21px]">
                                        <div className="flex flex-wrap items-start justify-between gap-[13px] pb-[21px] border-b border-slate-200 dark:border-[#12151C]">
                                            <div className="space-y-[8px]">
                                                <p className="text-microcopy font-mono uppercase tracking-widest text-[#C68346]">
                                                    {t('core_dev_vault.pilot_metrics.eyebrow')}
                                                </p>
                                                <h2 className="text-h1-header font-sans font-semibold text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {t('core_dev_vault.pilot_metrics.heading')}
                                                </h2>
                                                <p className="text-body-main font-sans text-[#475569] dark:text-[#8A93A6] max-w-3xl">
                                                    {t('core_dev_vault.pilot_metrics.subtitle')}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-[13px]">
                                                <span className="border border-slate-300 dark:border-[#12151C] bg-white dark:bg-[#000000] px-[13px] py-[8px] text-microcopy font-mono uppercase text-[#00AEEF] rounded-none">
                                                    {pilotMetrics
                                                        ? t('core_dev_vault.pilot_metrics.status_active')
                                                        : t('core_dev_vault.pilot_metrics.status_pending')}
                                                </span>
                                                <button
                                                    type="button"
                                                    onClick={() => void fetchPilotMetrics()}
                                                    title={t('core_dev_vault.pilot_metrics.refresh_aria')}
                                                    aria-label={t('core_dev_vault.pilot_metrics.refresh_aria')}
                                                    className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                                >
                                                    <span className="material-symbols-outlined text-[20px]">refresh</span>
                                                    <span className="sr-only">{t('core_dev_vault.pilot_metrics.refresh_aria')}</span>
                                                </button>
                                            </div>
                                        </div>

                                        {pilotMetricsLoading && (
                                            <M3LinearProgress
                                                indeterminate
                                                ariaLabel={t('core_dev_vault.pilot_metrics.loading_aria')}
                                            />
                                        )}

                                        {pilotMetricsError && (
                                            <div className="border border-red-500/60 bg-red-50 dark:bg-red-950/20 p-[13px] rounded-none text-data-dense font-mono text-red-700 dark:text-red-300">
                                                {pilotMetricsError}
                                            </div>
                                        )}

                                        {/* 3 KPIs Agregados Reales */}
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-[21px]">
                                            <div className="border border-slate-200 dark:border-[#12151C] bg-white dark:bg-[#000000] p-[21px] rounded-none shadow-none space-y-[13px]">
                                                <p className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                    {t('core_dev_vault.pilot_metrics.kpi_pilots_total')}
                                                </p>
                                                <p className="text-kpi-display font-mono tabular-nums font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {pilotMetrics ? pilotMetrics.pilots.total : 0}
                                                </p>
                                                <dl className="grid grid-cols-3 gap-[8px] pt-[13px] border-t border-slate-200 dark:border-[#12151C] text-microcopy font-mono tabular-nums">
                                                    <div>
                                                        <dt className="text-[#475569] dark:text-[#8A93A6]">
                                                            {t('core_dev_vault.pilot_metrics.kpi_pilots_active')}
                                                        </dt>
                                                        <dd className="text-[#00AEEF] font-bold">
                                                            {pilotMetrics?.pilots.active ?? 0}
                                                        </dd>
                                                    </div>
                                                    <div>
                                                        <dt className="text-[#475569] dark:text-[#8A93A6]">
                                                            {t('core_dev_vault.pilot_metrics.kpi_pilots_expired')}
                                                        </dt>
                                                        <dd className="text-[#C68346] font-bold">
                                                            {pilotMetrics?.pilots.expired ?? 0}
                                                        </dd>
                                                    </div>
                                                    <div>
                                                        <dt className="text-[#475569] dark:text-[#8A93A6]">
                                                            {t('core_dev_vault.pilot_metrics.kpi_pilots_revoked')}
                                                        </dt>
                                                        <dd className="text-[#475569] dark:text-[#8A93A6] font-bold">
                                                            {pilotMetrics?.pilots.revoked ?? 0}
                                                        </dd>
                                                    </div>
                                                </dl>
                                            </div>

                                            <div className="border border-slate-200 dark:border-[#12151C] bg-white dark:bg-[#000000] p-[21px] rounded-none shadow-none space-y-[13px]">
                                                <p className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                    {t('core_dev_vault.pilot_metrics.kpi_sandboxes_tenants')}
                                                </p>
                                                <p className="text-kpi-display font-mono tabular-nums font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {pilotMetrics ? pilotMetrics.sandboxes.pilotTenantsCount : 0}
                                                </p>
                                                <dl className="grid grid-cols-2 gap-[8px] pt-[13px] border-t border-slate-200 dark:border-[#12151C] text-microcopy font-mono tabular-nums">
                                                    <div>
                                                        <dt className="text-[#475569] dark:text-[#8A93A6]">
                                                            {t('core_dev_vault.pilot_metrics.kpi_sandboxes_assets')}
                                                        </dt>
                                                        <dd className="text-[#0F172A] dark:text-[#F3F4F6] font-bold">
                                                            {pilotMetrics?.sandboxes.tenantAssetsCount ?? 0}
                                                        </dd>
                                                    </div>
                                                    <div>
                                                        <dt className="text-[#475569] dark:text-[#8A93A6]">
                                                            {t('core_dev_vault.pilot_metrics.kpi_sandboxes_stockpiles')}
                                                        </dt>
                                                        <dd className="text-[#00AEEF] font-bold">
                                                            {pilotMetrics?.sandboxes.stockpilesCount ?? 0}
                                                        </dd>
                                                    </div>
                                                </dl>
                                            </div>

                                            <div className="border border-slate-200 dark:border-[#12151C] bg-white dark:bg-[#000000] p-[21px] rounded-none shadow-none space-y-[13px]">
                                                <p className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                    {t('core_dev_vault.pilot_metrics.kpi_ai_total')}
                                                </p>
                                                <p className="text-kpi-display font-mono tabular-nums font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                    {aiTotal}
                                                </p>
                                                <div className="pt-[13px] border-t border-slate-200 dark:border-[#12151C] space-y-1">
                                                    <p className="text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6]">
                                                        {t('core_dev_vault.pilot_metrics.last_activity_label')}
                                                    </p>
                                                    <p className="text-data-dense font-mono tabular-nums text-[#C68346]">
                                                        {lastActivityText}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Desglose por Módulo IA y Categoría IA con M3LinearProgress */}
                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-[21px]">
                                            <div className="border border-slate-200 dark:border-[#12151C] bg-white dark:bg-[#000000] p-[21px] rounded-none shadow-none space-y-[13px]">
                                                <p className="text-microcopy font-mono uppercase tracking-wider text-[#C68346]">
                                                    {t('core_dev_vault.pilot_metrics.breakdown_module_title')}
                                                </p>
                                                <div className="space-y-[13px]">
                                                    {moduleRows.map((row) => {
                                                        const pct = pctOf(row.count);
                                                        return (
                                                            <div key={row.key} className="space-y-[8px]">
                                                                <div className="flex items-center justify-between text-microcopy font-mono tabular-nums">
                                                                    <span className="text-[#475569] dark:text-[#8A93A6]">{row.label}</span>
                                                                    <span className="text-[#0F172A] dark:text-[#F3F4F6]">
                                                                        {row.count} ({pct}%)
                                                                    </span>
                                                                </div>
                                                                <M3LinearProgress
                                                                    value={pct}
                                                                    ariaLabel={`${t('core_dev_vault.pilot_metrics.progress_module_aria')}: ${row.label}`}
                                                                />
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>

                                            <div className="border border-slate-200 dark:border-[#12151C] bg-white dark:bg-[#000000] p-[21px] rounded-none shadow-none space-y-[13px]">
                                                <p className="text-microcopy font-mono uppercase tracking-wider text-[#00AEEF]">
                                                    {t('core_dev_vault.pilot_metrics.breakdown_category_title')}
                                                </p>
                                                <div className="space-y-[13px]">
                                                    {categoryRows.map((row) => {
                                                        const pct = pctOf(row.count);
                                                        return (
                                                            <div key={row.key} className="space-y-[8px]">
                                                                <div className="flex items-center justify-between text-microcopy font-mono tabular-nums">
                                                                    <span className="text-[#475569] dark:text-[#8A93A6]">{row.label}</span>
                                                                    <span className="text-[#0F172A] dark:text-[#F3F4F6]">
                                                                        {row.count} ({pct}%)
                                                                    </span>
                                                                </div>
                                                                <M3LinearProgress
                                                                    value={pct}
                                                                    ariaLabel={`${t('core_dev_vault.pilot_metrics.progress_category_aria')}: ${row.label}`}
                                                                />
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Prioridad y Estado Agregados (Cero textos libres / cero PII) */}
                                        <div className="border border-slate-200 dark:border-[#12151C] bg-white dark:bg-[#000000] p-[21px] rounded-none shadow-none space-y-[13px]">
                                            <p className="text-microcopy font-mono uppercase tracking-wider text-[#475569] dark:text-[#8A93A6]">
                                                {t('core_dev_vault.pilot_metrics.breakdown_priority_status_title')}
                                            </p>
                                            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-[13px] text-microcopy font-mono tabular-nums">
                                                <div className="border border-slate-200 dark:border-[#12151C] p-[8px]">
                                                    <p className="text-[#475569] dark:text-[#8A93A6]">{t('core_dev_vault.pilot_metrics.prio_low')}</p>
                                                    <p className="text-data-dense font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                        {pilotMetrics?.aiInteractions.byPriority.LOW ?? 0}
                                                    </p>
                                                </div>
                                                <div className="border border-slate-200 dark:border-[#12151C] p-[8px]">
                                                    <p className="text-[#475569] dark:text-[#8A93A6]">{t('core_dev_vault.pilot_metrics.prio_medium')}</p>
                                                    <p className="text-data-dense font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                        {pilotMetrics?.aiInteractions.byPriority.MEDIUM ?? 0}
                                                    </p>
                                                </div>
                                                <div className="border border-slate-200 dark:border-[#12151C] p-[8px]">
                                                    <p className="text-[#C68346]">{t('core_dev_vault.pilot_metrics.prio_high')}</p>
                                                    <p className="text-data-dense font-bold text-[#C68346]">
                                                        {pilotMetrics?.aiInteractions.byPriority.HIGH ?? 0}
                                                    </p>
                                                </div>
                                                <div className="border border-slate-200 dark:border-[#12151C] p-[8px]">
                                                    <p className="text-[#C68346]">{t('core_dev_vault.pilot_metrics.prio_critical')}</p>
                                                    <p className="text-data-dense font-bold text-[#C68346]">
                                                        {pilotMetrics?.aiInteractions.byPriority.CRITICAL ?? 0}
                                                    </p>
                                                </div>
                                                <div className="border border-slate-200 dark:border-[#12151C] p-[8px]">
                                                    <p className="text-[#475569] dark:text-[#8A93A6]">{t('core_dev_vault.pilot_metrics.status_pending_count')}</p>
                                                    <p className="text-data-dense font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                        {pilotMetrics?.aiInteractions.byStatus.PENDING ?? 0}
                                                    </p>
                                                </div>
                                                <div className="border border-slate-200 dark:border-[#12151C] p-[8px]">
                                                    <p className="text-[#475569] dark:text-[#8A93A6]">{t('core_dev_vault.pilot_metrics.status_reviewed_count')}</p>
                                                    <p className="text-data-dense font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                        {pilotMetrics?.aiInteractions.byStatus.REVIEWED ?? 0}
                                                    </p>
                                                </div>
                                                <div className="border border-slate-200 dark:border-[#12151C] p-[8px]">
                                                    <p className="text-[#00AEEF]">{t('core_dev_vault.pilot_metrics.status_applied_count')}</p>
                                                    <p className="text-data-dense font-bold text-[#00AEEF]">
                                                        {pilotMetrics?.aiInteractions.byStatus.APPLIED_TO_AI ?? 0}
                                                    </p>
                                                </div>
                                                <div className="border border-slate-200 dark:border-[#12151C] p-[8px]">
                                                    <p className="text-[#475569] dark:text-[#8A93A6]">{t('core_dev_vault.pilot_metrics.status_rejected_count')}</p>
                                                    <p className="text-data-dense font-bold text-[#475569] dark:text-[#8A93A6]">
                                                        {pilotMetrics?.aiInteractions.byStatus.REJECTED ?? 0}
                                                    </p>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="border-t border-slate-200 dark:border-[#12151C] pt-[21px] flex items-start gap-[13px]">
                                            <span className="material-symbols-outlined text-[20px] text-[#00AEEF] shrink-0">verified_user</span>
                                            <p className="text-data-dense font-mono text-[#475569] dark:text-[#8A93A6]">
                                                {t('core_dev_vault.pilot_metrics.isolation_notice')}
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            );
                        })()}

                        {/* CONTENIDO 2: BANDEJA DE SOLICITUDES DE EQUIPOS B2B (100% INTEGRADO EN DEV) */}
                        {activeSection === 'EQUIPMENT_ONBOARDING' && (
                            <div className="w-full h-full min-h-0 flex-1 flex flex-col">
                                <Suspense fallback={<M3ModuleHudFallback label={t('core_dev_vault.sections.loading_eq_inbox')} />}>
                                    <DevEquipmentOnboardingInbox />
                                </Suspense>
                            </div>
                        )}

                        {/* CONTENIDO 3: GESTOR DE LOGOS & IDENTIDAD (100% INTEGRADO EN DEV) */}
                        {activeSection === 'BRANDING' && (
                            <div className="max-w-5xl">
                                <BrandingManager />
                            </div>
                        )}

                        {/* MÓDULO INDUSTRIAL 1: GEOLAPP® · STOCKPILE CONTROL */}
                        {activeSection === 'MODULE_STOCKPILE' && (
                            <div className="w-full h-full min-h-0 overflow-hidden flex-1 flex flex-col">
                                <ModuleHost
                                    key="dev-geolapp-stockpile"
                                    moduleId="stockpile"
                                    embedded={true}
                                    domainMode="STOCKPILE"
                                    hostScope="DEV_GATEWAY"
                                    enforceEntitlement={false}
                                />
                            </div>
                        )}

                        {/* MÓDULO INDUSTRIAL 2A: CATÁLOGO MAESTRO ÚNICO (OPERMAQ CATALOG) */}
                        {activeSection === 'MODULE_OPERMAQ_CATALOG' && (
                            <div className="w-full h-full min-h-0 overflow-hidden flex-1 flex flex-col">
                                <ModuleHost
                                    key="dev-opermaq-catalog"
                                    moduleId="opermaq"
                                    embedded={true}
                                    domainMode="CATALOG"
                                    hostScope="DEV_GATEWAY"
                                    enforceEntitlement={false}
                                />
                            </div>
                        )}

                        {/* MÓDULO INDUSTRIAL 2B: CONTROL DE FLOTA (OPERMAQ FLEET) */}
                        {activeSection === 'MODULE_OPERMAQ_FLEET' && (
                            <div className="w-full h-full min-h-0 overflow-hidden flex-1 flex flex-col">
                                <ModuleHost
                                    key="dev-opermaq-fleet"
                                    moduleId="opermaq"
                                    embedded={true}
                                    domainMode="FLEET"
                                    hostScope="DEV_GATEWAY"
                                    enforceEntitlement={false}
                                />
                            </div>
                        )}

                        {/* MÓDULO INDUSTRIAL 2C: SIMBOLOGÍA TRANSVERSAL ISO 7000 (OPERMAQ SYMBOLOGY) */}
                        {activeSection === 'MODULE_OPERMAQ_SYMBOLOGY' && (
                            <div className="w-full h-full min-h-0 overflow-hidden flex-1 flex flex-col">
                                <ModuleHost
                                    key="dev-opermaq-symbology"
                                    moduleId="opermaq"
                                    embedded={true}
                                    domainMode="SYMBOLOGY"
                                    hostScope="DEV_GATEWAY"
                                    enforceEntitlement={false}
                                />
                            </div>
                        )}

                        {/* MÓDULO INDUSTRIAL 2D: FABRICANTES Y CANALES COMERCIALES (OPERMAQ MANUFACTURERS) */}
                        {activeSection === 'MODULE_OPERMAQ_MANUFACTURERS' && (
                            <div className="w-full h-full min-h-0 overflow-hidden flex-1 flex flex-col">
                                <ModuleHost
                                    key="dev-opermaq-manufacturers"
                                    moduleId="opermaq"
                                    embedded={true}
                                    domainMode="MANUFACTURERS"
                                    hostScope="DEV_GATEWAY"
                                    enforceEntitlement={false}
                                />
                            </div>
                        )}

                        {/* MÓDULO INDUSTRIAL 2E: AGENDA INDEPENDIENTE DE PROVEEDORES (OPERMAQ SUPPLIERS) */}
                        {activeSection === 'MODULE_OPERMAQ_SUPPLIERS' && (
                            <div className="w-full h-full min-h-0 overflow-hidden flex-1 flex flex-col">
                                <ModuleHost
                                    key="dev-opermaq-suppliers"
                                    moduleId="opermaq"
                                    embedded={true}
                                    domainMode="SUPPLIERS"
                                    hostScope="DEV_GATEWAY"
                                    enforceEntitlement={false}
                                />
                            </div>
                        )}

                    </div>
                </main>
            </div>

        </div>
    );
};

export default DevVaultGateway;
