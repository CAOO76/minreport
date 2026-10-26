import React, { useState, useEffect, useRef, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../../config/firebase';
import { signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { ThemeSwitch } from '../../components/ThemeSwitch';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import BrandLogo from '../../components/BrandLogo';
import BrandingManager from '../../components/admin/BrandingManager';

// Carga asíncrona de módulos industriales para navegación en cabina DEV
const StockpileModule = lazy(() => import('../../modules/stockpile/StockpileModule').then(m => ({ default: m.StockpileModule })));
const OpermaqModule = lazy(() => import('../../modules/opermaq/OpermaqModule').then(m => ({ default: m.OpermaqModule })));

interface TestPilot {
    id: string;
    accountId: string;
    collaboratorName: string;
    collaboratorEmail: string;
    organization?: string;
    purpose: string;
    status: string;
    expiresAt: number;
    createdAt: number;
}

type DevAuthState = 'IDLE' | 'WAITING_CONFIRMATION' | 'OTP' | 'USER' | 'PASSWORD' | 'PASSWORD_ROTATION';

export type DevSection =
    // Configuración MINREPORT
    | 'PILOTS'
    | 'IMPERSONATE'
    | 'B2B_EMPRESA'
    | 'STAFF'
    | 'JOB_PROFILES'
    | 'B2B_ADMINS'
    | 'BRANDING'
    | 'B2B_METRICAS'
    | 'B2B_SUSCRIPCION'
    // Módulos Industriales
    | 'MODULE_STOCKPILE'
    | 'MODULE_OPERMAQ';

export const DevVaultGateway: React.FC = () => {
    const navigate = useNavigate();
    const [activeSection, setActiveSection] = useState<DevSection>('PILOTS');
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
    const [timeLeft, setTimeLeft] = useState<number>(180);
    const [attemptsRemaining, setAttemptsRemaining] = useState<number>(3);

    // Campos de entrada escalonados
    const [otpDigits, setOtpDigits] = useState<string[]>(['', '', '', '', '', '']);
    const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
    const [loginEmail, setLoginEmail] = useState<string>('');
    const [loginPassword, setLoginPassword] = useState<string>('');
    const [oldPassword, setOldPassword] = useState<string>('');
    const [newPassword, setNewPassword] = useState<string>('');
    const [confirmPassword, setConfirmPassword] = useState<string>('');
    const [daysRemaining, setDaysRemaining] = useState<number>(30);

    const [loginLoading, setLoginLoading] = useState<boolean>(false);
    const [loginError, setLoginError] = useState<string | null>(null);

    // Estado Pilotos
    const [pilots, setPilots] = useState<TestPilot[]>([]);
    const [pilotsLoading, setPilotsLoading] = useState<boolean>(false);

    // Formulario Acreditar Piloto
    const [pilotName, setPilotName] = useState<string>('');
    const [pilotEmail, setPilotEmail] = useState<string>('');
    const [pilotOrg, setPilotOrg] = useState<string>('');
    const [pilotPurpose, setPilotPurpose] = useState<string>('');
    const [pilotDays, setPilotDays] = useState<number>(90);
    const [pilotSubmitting, setPilotSubmitting] = useState<boolean>(false);

    // Simulación View-as Client
    const [selectedTargetAccount, setSelectedTargetAccount] = useState<string>('dev-master-sandbox');
    const [impersonateLoading, setImpersonateLoading] = useState<boolean>(false);

    const apiBase = (import.meta as any).env?.VITE_API_URL 
        ? `${(import.meta as any).env.VITE_API_URL}/api/dev`
        : `http://${window.location.hostname}:8080/api/dev`;

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

        const savedToken = localStorage.getItem('dev_auth_token') || localStorage.getItem('dev_vault_token');
        if (savedToken) {
            setDevToken(savedToken);
            setIsAuthenticated(true);
            return;
        }

        // Inspeccionar si venimos de la confirmación directa desde el email (302 redirect)
        const params = new URLSearchParams(window.location.search);
        const cidParam = params.get('cid');
        const tokenParam = params.get('token');
        const errParam = params.get('error');

        if (errParam) {
            setLoginError(decodeURIComponent(errParam));
            window.history.replaceState({}, document.title, window.location.pathname);
        } else if (cidParam && tokenParam) {
            setChallengeId(cidParam);
            setClientToken(tokenParam);
            setExpiresAt(Date.now() + 180000);
            setTimeLeft(180);
            setAttemptsRemaining(3);
            setOtpDigits(['', '', '', '', '', '']);
            setAuthState('OTP');
            window.history.replaceState({}, document.title, window.location.pathname);
            setTimeout(() => {
                otpRefs.current[0]?.focus();
            }, 150);

            // Sincronizar en tiempo real con cualquier otra pestaña abierta en el navegador
            try {
                const bc = new BroadcastChannel('minreport_dev_gateway');
                bc.postMessage({
                    type: 'EMAIL_CONFIRMED',
                    challengeId: cidParam,
                    clientToken: tokenParam
                });
                bc.close();
            } catch { }
        }
    }, []);

    // Sincronización instantánea entre pestañas del navegador vía BroadcastChannel
    useEffect(() => {
        let channel: BroadcastChannel | null = null;
        try {
            channel = new BroadcastChannel('minreport_dev_gateway');
            channel.onmessage = (event) => {
                if (event.data?.type === 'EMAIL_CONFIRMED') {
                    if (event.data.challengeId) setChallengeId(event.data.challengeId);
                    if (event.data.clientToken) setClientToken(event.data.clientToken);
                    setExpiresAt(Date.now() + 180000);
                    setTimeLeft(180);
                    setAuthState('OTP');
                    setTimeout(() => {
                        otpRefs.current[0]?.focus();
                    }, 100);
                }
            };
        } catch { }

        return () => {
            try { channel?.close(); } catch { }
        };
    }, []);

    // Renovación y sincronización reactiva de credenciales DEV con Firebase Auth
    useEffect(() => {
        const unsubscribe = onAuthStateChanged(auth, async (user) => {
            if (user && (user.email?.toLowerCase() === 'dev@minreport.com' || user.uid === 'minreport-dev-root-superadmin-2026')) {
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

    useEffect(() => {
        if (isAuthenticated && devToken) {
            fetchPilots();
        }
    }, [isAuthenticated, devToken]);

    // Reloj de cuenta regresiva de 180s
    useEffect(() => {
        if (authState === 'IDLE') return;

        const timer = setInterval(() => {
            const diff = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
            setTimeLeft(diff);

            if (diff <= 0) {
                clearInterval(timer);
                setAuthState('IDLE');
                setLoginError('Sesión expirada (límite de 180 segundos alcanzado).');
                setOtpDigits(['', '', '', '', '', '']);
            }
        }, 1000);

        return () => clearInterval(timer);
    }, [authState, expiresAt]);

    // Polling silencioso en espera de confirmación desde el correo electrónico
    useEffect(() => {
        if (authState !== 'WAITING_CONFIRMATION' || !challengeId || !clientToken) return;

        let active = true;
        const pollInterval = setInterval(async () => {
            try {
                const resp = await fetch(`${apiBase}/auth/challenge/status/${challengeId}?clientToken=${clientToken}`);
                if (!resp.ok) return;
                const data = await resp.json();

                if (!active) return;

                if (data.status === 'EMAIL_CONFIRMED') {
                    clearInterval(pollInterval);
                    // Solo al confirmar desde el email se activan los campos
                    setAuthState('OTP');
                    setTimeout(() => {
                        otpRefs.current[0]?.focus();
                    }, 100);
                    try {
                        const bc = new BroadcastChannel('minreport_dev_gateway');
                        bc.postMessage({
                            type: 'EMAIL_CONFIRMED',
                            challengeId,
                            clientToken
                        });
                        bc.close();
                    } catch { }
                } else if (data.status === 'REVOKED' || data.status === 'COMPLETED') {
                    clearInterval(pollInterval);
                    setAuthState('IDLE');
                    setLoginError('Sesión de desafío expirada o revocada.');
                }
            } catch {
                // Silencioso
            }
        }, 600);

        return () => {
            active = false;
            clearInterval(pollInterval);
        };
    }, [authState, challengeId, clientToken, apiBase]);

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
                throw new Error(data.error || 'Fallo al iniciar sesión de desafío DEV');
            }

            setChallengeId(data.challengeId);
            setClientToken(data.clientToken);
            setExpiresAt(data.expiresAt);
            setTimeLeft(180);
            setAttemptsRemaining(3);
            setOtpDigits(['', '', '', '', '', '']);
            // Transición directa y fluida a OTP en la misma pantalla (cero nuevas pestañas ni parpadeos)
            setAuthState('OTP');
            setTimeout(() => {
                otpRefs.current[0]?.focus();
            }, 100);
        } catch (err: any) {
            setLoginError(err.message || 'Error iniciando desafío');
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
                    setLoginError('Límite de intentos superado. Sesión autodestruida.');
                    setOtpDigits(['', '', '', '', '', '']);
                } else {
                    setLoginError(`Código dinámico incorrecto. Intentos restantes: ${data.attemptsRemaining}`);
                    setAttemptsRemaining(data.attemptsRemaining);
                    setOtpDigits(['', '', '', '', '', '']);
                    otpRefs.current[0]?.focus();
                }
                return;
            }

            setStepToken(data.stepToken);
            setAuthState('USER');
        } catch (err: any) {
            setLoginError(err.message || 'Error validando código');
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
                throw new Error(data.error || 'Identidad no autorizada');
            }

            setDaysRemaining(data.daysRemaining);
            if (data.requiresPasswordRotation) {
                setAuthState('PASSWORD_ROTATION');
            } else {
                setAuthState('PASSWORD');
            }
        } catch (err: any) {
            setLoginError(err.message || 'Identidad no autorizada');
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
                    throw new Error('La nueva clave debe tener al menos 8 caracteres.');
                }
                if (newPassword !== confirmPassword) {
                    throw new Error('La confirmación de la nueva clave no coincide.');
                }
                if (newPassword === oldPassword) {
                    throw new Error('La nueva clave debe ser diferente a la actual.');
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
                throw new Error(data.error || 'Credenciales inválidas');
            }

            const token = data.token || data.firebaseToken;
            localStorage.setItem('dev_auth_token', token);
            setDevToken(token);
            setIsAuthenticated(true);

            if (data.firebaseToken) {
                try {
                    const cred = await signInWithCustomToken(auth, data.firebaseToken);
                    const freshToken = await cred.user.getIdToken(true);
                    localStorage.setItem('dev_auth_token', freshToken);
                    setDevToken(freshToken);
                } catch (fbErr) {
                    console.warn('[DEV] Firebase sync warning:', fbErr);
                }
            }
        } catch (err: any) {
            setLoginError(err.message || 'Fallo de autenticación');
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
        localStorage.removeItem('dev_is_impersonating');
        localStorage.removeItem('dev_impersonated_account');
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

    /**
     * Cliente HTTP autenticado resiliente para operaciones DEV.
     * Renueva automáticamente el token ID de Firebase ante vencimiento o desincronización (401).
     */
    const fetchWithDevAuth = async (endpoint: string, options: RequestInit = {}): Promise<Response> => {
        let activeToken = devToken || localStorage.getItem('dev_auth_token') || '';
        if (auth.currentUser) {
            try {
                activeToken = await auth.currentUser.getIdToken();
                setDevToken(activeToken);
                localStorage.setItem('dev_auth_token', activeToken);
            } catch { }
        }

        const headers: Record<string, string> = {
            ...((options.headers as Record<string, string>) || {}),
            'Authorization': `Bearer ${activeToken}`
        };

        let resp = await fetch(`${apiBase}${endpoint}`, {
            ...options,
            headers
        });

        if (resp.status === 401) {
            // Intento de re-autenticación forzada si hay sesión Firebase activa
            if (auth.currentUser) {
                try {
                    const refreshed = await auth.currentUser.getIdToken(true);
                    setDevToken(refreshed);
                    localStorage.setItem('dev_auth_token', refreshed);
                    headers['Authorization'] = `Bearer ${refreshed}`;
                    resp = await fetch(`${apiBase}${endpoint}`, {
                        ...options,
                        headers
                    });
                } catch { }
            }

            if (resp.status === 401) {
                console.warn('[DEV] Sesión DEV expirada o inválida (401). Retornando a terminal...');
                await handleLogout();
                setLoginError('Sesión DEV expirada o no autorizada. Por favor inicie sesión nuevamente.');
            }
        }

        return resp;
    };

    const fetchPilots = async () => {
        setPilotsLoading(true);
        try {
            const resp = await fetchWithDevAuth('/test-pilots');
            if (resp.ok) {
                const data = await resp.json();
                setPilots(data);
            }
        } catch (err) {
            console.error('[DEV] Error fetching pilots:', err);
        } finally {
            setPilotsLoading(false);
        }
    };

    const handleCreatePilot = async (e: React.FormEvent) => {
        e.preventDefault();
        setPilotSubmitting(true);

        try {
            const resp = await fetchWithDevAuth('/test-pilots', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    collaboratorName: pilotName.trim(),
                    collaboratorEmail: pilotEmail.trim().toLowerCase(),
                    organization: pilotOrg.trim() || undefined,
                    purpose: pilotPurpose.trim(),
                    expiresDays: Number(pilotDays)
                })
            });

            if (!resp.ok) {
                const data = await resp.json();
                throw new Error(data.error || 'Error al acreditar piloto');
            }

            setPilotName('');
            setPilotEmail('');
            setPilotOrg('');
            setPilotPurpose('');
            fetchPilots();
        } catch (err: any) {
            alert(err.message || 'Error al crear piloto');
        } finally {
            setPilotSubmitting(false);
        }
    };

    const handleRevokePilot = async (id: string) => {
        const confirmText = prompt(`Escriba "REVOCAR" para confirmar la baja del piloto ${id}:`);
        if (confirmText !== 'REVOCAR') return;

        try {
            const resp = await fetchWithDevAuth(`/test-pilots/${id}`, {
                method: 'DELETE'
            });
            if (resp.ok) {
                fetchPilots();
            }
        } catch (err) {
            console.error('[DEV] Error revocando piloto:', err);
        }
    };

    const handleLaunchImpersonation = async () => {
        setImpersonateLoading(true);
        try {
            const resp = await fetchWithDevAuth('/impersonate-client', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ targetAccountId: selectedTargetAccount })
            });

            const data = await resp.json();
            if (!resp.ok) {
                throw new Error(data.error || 'Error al iniciar simulación');
            }

            localStorage.setItem('dev_is_impersonating', 'true');
            localStorage.setItem('dev_impersonated_account', JSON.stringify(data.simulatedAccount));

            if (data.impersonationToken) {
                await signInWithCustomToken(auth, data.impersonationToken);
            }

            navigate('/dashboard');
        } catch (err: any) {
            alert(err.message || 'Error al iniciar simulación');
        } finally {
            setImpersonateLoading(false);
        }
    };

    // =========================================================================
    // VISTA 1: ACCESO DEV SILENCIOSO & DESAFÍO PROGRESSIVO (MINIMALISMO ABSOLUTO)
    // =========================================================================
    if (!isAuthenticated) {
        return (
            <div className="min-h-screen bg-white dark:bg-[#000000] text-slate-900 dark:text-[#F3F4F6] flex flex-col items-center justify-center p-6 antialiased select-none font-sans relative">
                
                {/* Controles Flotantes Superior */}
                <div className="absolute top-6 right-6 flex items-center gap-3 z-50">
                    <LanguageSwitch />
                    <ThemeSwitch />
                </div>

                {/* ESTADO 0: SILENCIO ABSOLUTO (ÚNICAMENTE EL LOGO COMO BOTÓN INTERACTIVO) */}
                {authState === 'IDLE' && (
                    <div className="flex flex-col items-center justify-center">
                        <button
                            type="button"
                            onClick={handleInitChallenge}
                            disabled={loginLoading}
                            aria-label="MINREPORT"
                            className="bg-transparent border-0 outline-none p-4 cursor-pointer transition-transform duration-300 hover:scale-105 active:scale-95 disabled:opacity-50"
                        >
                            <BrandLogo variant="isotype" className="h-20 w-auto object-contain pointer-events-none" />
                        </button>

                        {loginError && (
                            <div className="mt-6 p-2 text-xs font-mono text-red-500 border border-red-500/20 bg-red-500/5 rounded-none max-w-xs text-center">
                                {loginError}
                            </div>
                        )}
                    </div>
                )}

                {/* ESTADO 1: ESPERANDO CONFIRMACIÓN DESDE EL EMAIL (CAMPOS TOTALMENTE OCULTOS) */}
                {authState === 'WAITING_CONFIRMATION' && (
                    <div className="flex flex-col items-center justify-center space-y-6">
                        <div className="p-4 animate-pulse">
                            <BrandLogo variant="isotype" className="h-20 w-auto object-contain pointer-events-none opacity-80" />
                        </div>

                        <div className="flex items-center gap-4 text-xs font-mono text-slate-400 dark:text-[#5A6072]">
                            <span className="tabular-nums font-mono">{timeLeft}s</span>
                            <span className="text-slate-300 dark:text-[#12151C]">•</span>
                            <button
                                type="button"
                                onClick={handleAbortChallenge}
                                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                title="Cancelar"
                            >
                                <span className="material-symbols-outlined text-[18px]">close</span>
                            </button>
                        </div>

                        {loginError && (
                            <div className="p-2 text-xs font-mono text-red-500 border border-red-500/20 bg-red-500/5 rounded-none max-w-xs text-center">
                                {loginError}
                            </div>
                        )}
                    </div>
                )}

                {/* ESTADOS CON CAMPOS HABILITADOS: SOLO TRAS CONFIRMAR DESDE EL EMAIL */}
                {(authState === 'OTP' || authState === 'USER' || authState === 'PASSWORD' || authState === 'PASSWORD_ROTATION') && (
                    <div className="w-full max-w-sm mx-auto space-y-6">
                        
                        {/* Cabecera Discreta */}
                        <div className="flex items-center justify-between border-b border-slate-200 dark:border-[#12151C] pb-3">
                            <div className="flex items-center gap-2">
                                <BrandLogo variant="isotype" className="h-6 w-auto object-contain" />
                            </div>
                            <span className="font-mono text-[10px] text-slate-400 dark:text-[#5A6072] tabular-nums">
                                {timeLeft}s
                            </span>
                        </div>

                        {loginError && (
                            <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-mono rounded-none">
                                {loginError}
                            </div>
                        )}

                        {/* SUB-ESTADO: OTP (6 CASILLEROS DISCRETOS CON ICONO AD-HOC) */}
                        {authState === 'OTP' && (
                            <div className="bg-[#F8FAFC] dark:bg-[#07090D] border border-slate-200 dark:border-[#12151C] p-6 rounded-none space-y-6">
                                <div className="flex justify-center items-center py-1">
                                    <span className="material-symbols-outlined text-slate-400 dark:text-[#8A93A6] text-xl select-none">
                                        pin
                                    </span>
                                </div>

                                <div className="flex justify-between gap-2" onPaste={handleOtpPaste}>
                                    {otpDigits.map((digit, idx) => (
                                        <input
                                            key={idx}
                                            ref={el => { otpRefs.current[idx] = el; }}
                                            type="text"
                                            inputMode="numeric"
                                            maxLength={1}
                                            value={digit}
                                            onChange={e => handleOtpChange(idx, e.target.value)}
                                            onKeyDown={e => handleOtpKeyDown(idx, e)}
                                            autoComplete="off"
                                            spellCheck={false}
                                            className="w-11 h-14 bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#12151C] focus:border-[#C68346] text-slate-900 dark:text-[#F3F4F6] text-center text-2xl font-mono tabular-nums font-bold rounded-none outline-none transition-colors"
                                        />
                                    ))}
                                </div>

                                <div className="flex justify-between items-center text-[10px] font-mono text-slate-400 dark:text-[#5A6072]">
                                    <span className="tabular-nums font-mono">{attemptsRemaining}/3</span>
                                    <button
                                        type="button"
                                        onClick={handleAbortChallenge}
                                        className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                        title="Cancelar"
                                    >
                                        <span className="material-symbols-outlined text-[16px]">close</span>
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* SUB-ESTADO: USUARIO (ICONO AD-HOC, CERO TEXTO DE PISTA) */}
                        {authState === 'USER' && (
                            <div className="bg-[#F8FAFC] dark:bg-[#07090D] border border-slate-200 dark:border-[#12151C] p-6 rounded-none space-y-4">
                                <form onSubmit={handleVerifyUser} autoComplete="off" spellCheck={false} className="space-y-4">
                                    <div className="relative flex items-center">
                                        <span className="material-symbols-outlined absolute left-3 text-slate-400 dark:text-[#8A93A6] text-[18px] select-none pointer-events-none">
                                            person
                                        </span>
                                        <input
                                            type="text"
                                            inputMode="email"
                                            value={loginEmail}
                                            onChange={e => setLoginEmail(e.target.value)}
                                            required
                                            autoFocus
                                            autoComplete="off"
                                            spellCheck={false}
                                            placeholder=""
                                            className="w-full bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#12151C] focus:border-[#C68346] text-slate-900 dark:text-[#F3F4F6] pl-10 pr-3 py-2.5 text-xs font-mono outline-none rounded-none transition-colors"
                                        />
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={loginLoading}
                                        className="w-full py-2.5 bg-[#C68346] hover:bg-[#b0743e] text-white font-mono font-bold text-xs uppercase tracking-wider transition-colors disabled:opacity-50 cursor-pointer rounded-none outline-none flex items-center justify-center"
                                    >
                                        {loginLoading ? (
                                            <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                                        ) : (
                                            <span className="material-symbols-outlined text-[18px]">arrow_forward</span>
                                        )}
                                    </button>
                                </form>
                            </div>
                        )}

                        {/* SUB-ESTADO: CLAVE TRADICIONAL (ICONO AD-HOC, CERO TEXTO DE PISTA) */}
                        {authState === 'PASSWORD' && (
                            <div className="bg-[#F8FAFC] dark:bg-[#07090D] border border-slate-200 dark:border-[#12151C] p-6 rounded-none space-y-4">
                                <form onSubmit={handleLoginFinal} autoComplete="off" spellCheck={false} className="space-y-4">
                                    <div className="relative flex items-center">
                                        <span className="material-symbols-outlined absolute left-3 text-slate-400 dark:text-[#8A93A6] text-[18px] select-none pointer-events-none">
                                            key
                                        </span>
                                        <input
                                            type="password"
                                            value={loginPassword}
                                            onChange={e => setLoginPassword(e.target.value)}
                                            required
                                            autoFocus
                                            autoComplete="new-password"
                                            spellCheck={false}
                                            placeholder=""
                                            className="w-full bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#12151C] focus:border-[#C68346] text-slate-900 dark:text-[#F3F4F6] pl-10 pr-3 py-2.5 text-xs font-mono outline-none rounded-none transition-colors"
                                        />
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={loginLoading}
                                        className="w-full py-2.5 bg-[#C68346] hover:bg-[#b0743e] text-white font-mono font-bold text-xs uppercase tracking-wider transition-colors disabled:opacity-50 cursor-pointer rounded-none outline-none flex items-center justify-center"
                                    >
                                        {loginLoading ? (
                                            <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                                        ) : (
                                            <span className="material-symbols-outlined text-[18px]">lock_open</span>
                                        )}
                                    </button>
                                </form>
                            </div>
                        )}

                        {/* SUB-ESTADO: ROTACIÓN DE CLAVE (ICONOS AD-HOC, CERO TEXTOS DE PISTA) */}
                        {authState === 'PASSWORD_ROTATION' && (
                            <div className="bg-[#F8FAFC] dark:bg-[#07090D] border border-[#C68346]/40 p-6 rounded-none space-y-4">
                                <div className="flex justify-between items-center py-1">
                                    <span className="material-symbols-outlined text-[#C68346] text-xl select-none">
                                        lock_reset
                                    </span>
                                    <span className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-[#8A93A6]">
                                        {daysRemaining}d
                                    </span>
                                </div>

                                <form onSubmit={handleLoginFinal} autoComplete="off" spellCheck={false} className="space-y-4">
                                    <div className="relative flex items-center">
                                        <span className="material-symbols-outlined absolute left-3 text-slate-400 dark:text-[#8A93A6] text-[18px] select-none pointer-events-none">
                                            key
                                        </span>
                                        <input
                                            type="password"
                                            value={oldPassword}
                                            onChange={e => setOldPassword(e.target.value)}
                                            required
                                            autoFocus
                                            autoComplete="off"
                                            spellCheck={false}
                                            placeholder=""
                                            className="w-full bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#12151C] focus:border-[#C68346] text-slate-900 dark:text-[#F3F4F6] pl-10 pr-3 py-2.5 text-xs font-mono outline-none rounded-none transition-colors"
                                        />
                                    </div>

                                    <div className="relative flex items-center">
                                        <span className="material-symbols-outlined absolute left-3 text-slate-400 dark:text-[#8A93A6] text-[18px] select-none pointer-events-none">
                                            lock
                                        </span>
                                        <input
                                            type="password"
                                            value={newPassword}
                                            onChange={e => setNewPassword(e.target.value)}
                                            required
                                            minLength={8}
                                            autoComplete="new-password"
                                            spellCheck={false}
                                            placeholder=""
                                            className="w-full bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#12151C] focus:border-[#C68346] text-slate-900 dark:text-[#F3F4F6] pl-10 pr-3 py-2.5 text-xs font-mono outline-none rounded-none transition-colors"
                                        />
                                    </div>

                                    <div className="relative flex items-center">
                                        <span className="material-symbols-outlined absolute left-3 text-slate-400 dark:text-[#8A93A6] text-[18px] select-none pointer-events-none">
                                            verified_user
                                        </span>
                                        <input
                                            type="password"
                                            value={confirmPassword}
                                            onChange={e => setConfirmPassword(e.target.value)}
                                            required
                                            minLength={8}
                                            autoComplete="new-password"
                                            spellCheck={false}
                                            placeholder=""
                                            className="w-full bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#12151C] focus:border-[#C68346] text-slate-900 dark:text-[#F3F4F6] pl-10 pr-3 py-2.5 text-xs font-mono outline-none rounded-none transition-colors"
                                        />
                                    </div>

                                    <button
                                        type="submit"
                                        disabled={loginLoading}
                                        className="w-full py-2.5 bg-[#C68346] hover:bg-[#b0743e] text-white font-mono font-bold text-xs uppercase tracking-wider transition-colors disabled:opacity-50 cursor-pointer rounded-none outline-none flex items-center justify-center"
                                    >
                                        {loginLoading ? (
                                            <span className="material-symbols-outlined animate-spin text-[18px]">progress_activity</span>
                                        ) : (
                                            <span className="material-symbols-outlined text-[18px]">sync</span>
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
        <div className="min-h-screen bg-white dark:bg-[#000000] text-slate-900 dark:text-[#F3F4F6] flex font-sans select-none antialiased">
            
            {/* =========================================================================
                COLUMNA LATERAL IZQUIERDA: MENÚ MINIMALISTA ABSOLUTO DE CONFIGURACIÓN & MÓDULOS
                ========================================================================= */}
            <aside className="w-14 sm:w-16 h-screen sticky top-0 flex flex-col items-center py-4 border-r border-slate-200 dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#07090D] z-40 select-none shrink-0">
                
                {/* Isotipo Superior Interactivo */}
                <button
                    type="button"
                    onClick={() => setActiveSection('PILOTS')}
                    title="MINREPORT DEV"
                    aria-label="MINREPORT"
                    className="bg-transparent border-0 outline-none p-2 mb-3 cursor-pointer transition-transform hover:scale-105 active:scale-95"
                >
                    <BrandLogo variant="isotype" className="h-6 w-auto object-contain pointer-events-none" />
                </button>

                {/* GRUPO 1: CONFIGURAR MINREPORT (BOTONES PLANOS TRANSPARENTES) */}
                <div className="flex flex-col items-center gap-1 w-full">
                    <button
                        type="button"
                        onClick={() => setActiveSection('PILOTS')}
                        title="Pilotos & Accesos DEV"
                        aria-label="Pilotos"
                        className={`w-full py-2.5 bg-transparent border-0 outline-none transition-colors cursor-pointer rounded-none relative flex items-center justify-center ${
                            activeSection === 'PILOTS'
                                ? 'text-[#C68346]'
                                : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        {activeSection === 'PILOTS' && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-[#C68346]" />
                        )}
                        <span className="material-symbols-outlined text-[20px]">group_add</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveSection('IMPERSONATE')}
                        title="Simulación Cliente"
                        aria-label="Simulación"
                        className={`w-full py-2.5 bg-transparent border-0 outline-none transition-colors cursor-pointer rounded-none relative flex items-center justify-center ${
                            activeSection === 'IMPERSONATE'
                                ? 'text-[#C68346]'
                                : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        {activeSection === 'IMPERSONATE' && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-[#C68346]" />
                        )}
                        <span className="material-symbols-outlined text-[20px]">switch_account</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveSection('B2B_EMPRESA')}
                        title="Empresa B2B"
                        aria-label="Empresa"
                        className={`w-full py-2.5 bg-transparent border-0 outline-none transition-colors cursor-pointer rounded-none relative flex items-center justify-center ${
                            activeSection === 'B2B_EMPRESA'
                                ? 'text-[#C68346]'
                                : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        {activeSection === 'B2B_EMPRESA' && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-[#C68346]" />
                        )}
                        <span className="material-symbols-outlined text-[20px]">domain</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveSection('STAFF')}
                        title="Staff Operativo"
                        aria-label="Staff"
                        className={`w-full py-2.5 bg-transparent border-0 outline-none transition-colors cursor-pointer rounded-none relative flex items-center justify-center ${
                            activeSection === 'STAFF'
                                ? 'text-[#C68346]'
                                : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        {activeSection === 'STAFF' && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-[#C68346]" />
                        )}
                        <span className="material-symbols-outlined text-[20px]">groups</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveSection('JOB_PROFILES')}
                        title="Perfiles de Cargo"
                        aria-label="Perfiles"
                        className={`w-full py-2.5 bg-transparent border-0 outline-none transition-colors cursor-pointer rounded-none relative flex items-center justify-center ${
                            activeSection === 'JOB_PROFILES'
                                ? 'text-[#C68346]'
                                : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        {activeSection === 'JOB_PROFILES' && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-[#C68346]" />
                        )}
                        <span className="material-symbols-outlined text-[20px]">assignment_ind</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveSection('B2B_ADMINS')}
                        title="Gobernanza Administradores"
                        aria-label="Administradores"
                        className={`w-full py-2.5 bg-transparent border-0 outline-none transition-colors cursor-pointer rounded-none relative flex items-center justify-center ${
                            activeSection === 'B2B_ADMINS'
                                ? 'text-[#C68346]'
                                : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        {activeSection === 'B2B_ADMINS' && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-[#C68346]" />
                        )}
                        <span className="material-symbols-outlined text-[20px]">admin_panel_settings</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveSection('BRANDING')}
                        title="Gestor de Logos & Identidad"
                        aria-label="Gestor de Logos"
                        className={`w-full py-2.5 bg-transparent border-0 outline-none transition-colors cursor-pointer rounded-none relative flex items-center justify-center ${
                            activeSection === 'BRANDING'
                                ? 'text-[#C68346]'
                                : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        {activeSection === 'BRANDING' && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-[#C68346]" />
                        )}
                        <span className="material-symbols-outlined text-[20px]">palette</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveSection('B2B_METRICAS')}
                        title="Métricas & Auditoría"
                        aria-label="Métricas"
                        className={`w-full py-2.5 bg-transparent border-0 outline-none transition-colors cursor-pointer rounded-none relative flex items-center justify-center ${
                            activeSection === 'B2B_METRICAS'
                                ? 'text-[#C68346]'
                                : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        {activeSection === 'B2B_METRICAS' && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-[#C68346]" />
                        )}
                        <span className="material-symbols-outlined text-[20px]">monitoring</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveSection('B2B_SUSCRIPCION')}
                        title="Suscripción & Licenciamiento"
                        aria-label="Suscripción"
                        className={`w-full py-2.5 bg-transparent border-0 outline-none transition-colors cursor-pointer rounded-none relative flex items-center justify-center ${
                            activeSection === 'B2B_SUSCRIPCION'
                                ? 'text-[#C68346]'
                                : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        {activeSection === 'B2B_SUSCRIPCION' && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-[#C68346]" />
                        )}
                        <span className="material-symbols-outlined text-[20px]">verified</span>
                    </button>
                </div>

                {/* SEPARADOR DE PRECISIÓN FIBONACCI */}
                <div className="w-6 h-[1px] bg-slate-200 dark:bg-[#12151C] my-3 shrink-0" />

                {/* GRUPO 2: MÓDULOS INDUSTRIALES (STOCKPILE, OPERMAQ, MINING FLOW) */}
                <div className="flex flex-col items-center gap-1 w-full">
                    <button
                        type="button"
                        onClick={() => setActiveSection('MODULE_STOCKPILE')}
                        title="Módulo Stockpile (Cubicaciones & 3D)"
                        aria-label="Stockpile"
                        className={`w-full py-2.5 bg-transparent border-0 outline-none transition-colors cursor-pointer rounded-none relative flex items-center justify-center ${
                            activeSection === 'MODULE_STOCKPILE'
                                ? 'text-[#C68346]'
                                : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        {activeSection === 'MODULE_STOCKPILE' && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-[#C68346]" />
                        )}
                        <span className="material-symbols-outlined text-[20px]">layers</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveSection('MODULE_OPERMAQ')}
                        title="Módulo Opermaq (Flota & Maquinaria)"
                        aria-label="Opermaq"
                        className={`w-full py-2.5 bg-transparent border-0 outline-none transition-colors cursor-pointer rounded-none relative flex items-center justify-center ${
                            activeSection === 'MODULE_OPERMAQ'
                                ? 'text-[#C68346]'
                                : 'text-slate-400 hover:text-slate-900 dark:hover:text-white'
                        }`}
                    >
                        {activeSection === 'MODULE_OPERMAQ' && (
                            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-[#C68346]" />
                        )}
                        <span className="material-symbols-outlined text-[20px]">local_shipping</span>
                    </button>
                </div>

                {/* PIE DE BARRA LATERAL: TEMA, IDIOMA Y SALIR */}
                <div className="mt-auto flex flex-col items-center gap-2 pt-3 border-t border-slate-200 dark:border-[#12151C] w-full shrink-0">
                    <ThemeSwitch />
                    <LanguageSwitch />
                    <button
                        type="button"
                        onClick={handleLogout}
                        title="Cerrar sesión DEV"
                        aria-label="Salir"
                        className="w-full py-2 bg-transparent border-0 outline-none text-slate-400 hover:text-red-500 transition-colors cursor-pointer flex items-center justify-center rounded-none"
                    >
                        <span className="material-symbols-outlined text-[20px]">logout</span>
                    </button>
                </div>
            </aside>

            {/* =========================================================================
                ÁREA DE TRABAJO PRINCIPAL (CAMBIA SEGÚN EL BOTÓN ACTIVO)
                ========================================================================= */}
            <main className={`flex-1 min-h-screen ${isModuleSection ? 'p-0 overflow-hidden flex flex-col' : 'p-8 overflow-y-auto'}`}>
                
                {/* Header Técnico Aséptico Superior (Oculto en módulos para visualización integrada a pantalla completa) */}
                {!isModuleSection && (
                    <div className="mb-8 border-b border-slate-200 dark:border-[#12151C] pb-6 flex justify-between items-end">
                        <div>
                            <span className="text-[10px] uppercase tracking-widest text-[#C68346] font-bold font-mono">
                                CONFIGURACIÓN MINREPORT
                            </span>
                            <h1 className="text-xl font-bold tracking-tight uppercase font-sans text-slate-900 dark:text-[#F3F4F6] mt-0.5">
                                {activeSection === 'PILOTS' && 'PILOTOS ACTIVOS'}
                                {activeSection === 'IMPERSONATE' && 'SIMULACIÓN DE CLIENTE'}
                                {activeSection === 'B2B_EMPRESA' && 'DATOS DE EMPRESA'}
                                {activeSection === 'STAFF' && 'PERSONAL OPERATIVO'}
                                {activeSection === 'JOB_PROFILES' && 'MATRIZ DE CARGOS'}
                                {activeSection === 'B2B_ADMINS' && 'ADMINISTRADORES'}
                                {activeSection === 'B2B_METRICAS' && 'MÉTRICAS OPERACIONALES'}
                                {activeSection === 'B2B_SUSCRIPCION' && 'ESTADO DE LICENCIA'}
                            </h1>
                        </div>

                        <div className="flex items-center gap-6">
                            <div className="text-right">
                                <span className="text-[10px] uppercase tracking-widest text-slate-400 dark:text-[#5A6072] font-mono">PILOTOS ACTIVOS</span>
                                <p className="text-xl font-mono tabular-nums text-slate-900 dark:text-[#F3F4F6] font-bold">
                                    {pilots.filter(p => p.status === 'ACTIVE').length}
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {/* CONTENIDO 1: GESTIÓN DE PILOTOS */}
                {activeSection === 'PILOTS' && (
                    <div className="space-y-8">
                        {/* Módulo Alta TEST-PILOT */}
                        <div className="border border-slate-200 dark:border-[#12151C] p-6 rounded-none bg-[#F8FAFC] dark:bg-[#07090D]">
                            <h2 className="text-xs font-mono font-bold uppercase tracking-wider mb-4 text-[#C68346]">
                                ALTA DE PILOTO
                            </h2>

                            <form onSubmit={handleCreatePilot} autoComplete="off" spellCheck={false} className="flex flex-col lg:flex-row gap-4 items-end">
                                <div className="flex-1 w-full">
                                    <label className="block text-xs uppercase tracking-wider text-slate-500 dark:text-[#8A93A6] mb-1 font-mono">NOMBRE</label>
                                    <input
                                        required
                                        type="text"
                                        value={pilotName}
                                        onChange={e => setPilotName(e.target.value)}
                                        className="w-full bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#12151C] px-3 py-2 text-xs font-mono focus:outline-none focus:border-[#C68346] rounded-none"
                                    />
                                </div>

                                <div className="flex-1 w-full">
                                    <label className="block text-xs uppercase tracking-wider text-slate-500 dark:text-[#8A93A6] mb-1 font-mono">EMAIL</label>
                                    <input
                                        required
                                        type="email"
                                        value={pilotEmail}
                                        onChange={e => setPilotEmail(e.target.value)}
                                        className="w-full bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#12151C] px-3 py-2 text-xs font-mono focus:outline-none focus:border-[#C68346] rounded-none select-text"
                                    />
                                </div>

                                <div className="flex-1 w-full">
                                    <label className="block text-xs uppercase tracking-wider text-slate-500 dark:text-[#8A93A6] mb-1 font-mono">ORGANIZACIÓN</label>
                                    <input
                                        type="text"
                                        value={pilotOrg}
                                        onChange={e => setPilotOrg(e.target.value)}
                                        placeholder="Minera / Partner"
                                        className="w-full bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#12151C] px-3 py-2 text-xs font-mono focus:outline-none focus:border-[#C68346] rounded-none"
                                    />
                                </div>

                                <div className="w-24">
                                    <label className="block text-xs uppercase tracking-wider text-slate-500 dark:text-[#8A93A6] mb-1 font-mono">DÍAS</label>
                                    <input
                                        type="number"
                                        min={7}
                                        max={365}
                                        value={pilotDays}
                                        onChange={e => setPilotDays(Number(e.target.value))}
                                        className="w-full bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#12151C] px-3 py-2 text-xs font-mono tabular-nums focus:outline-none focus:border-[#C68346] rounded-none"
                                    />
                                </div>

                                <div className="flex-1 w-full">
                                    <label className="block text-xs uppercase tracking-wider text-slate-500 dark:text-[#8A93A6] mb-1 font-mono">PROPÓSITO</label>
                                    <input
                                        required
                                        type="text"
                                        value={pilotPurpose}
                                        onChange={e => setPilotPurpose(e.target.value)}
                                        placeholder="Pruebas de módulo"
                                        className="w-full bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#12151C] px-3 py-2 text-xs font-mono focus:outline-none focus:border-[#C68346] rounded-none"
                                    />
                                </div>

                                <button
                                    type="submit"
                                    disabled={pilotSubmitting}
                                    className="w-full lg:w-auto bg-[#C68346] hover:bg-[#b0743e] text-white font-mono font-bold uppercase tracking-wider text-xs py-2.5 px-6 transition-colors rounded-none disabled:opacity-50 cursor-pointer"
                                >
                                    {pilotSubmitting ? 'ACREDITANDO...' : 'ACREDITAR'}
                                </button>
                            </form>
                        </div>

                        {/* Módulo Tabla TEST-PILOT */}
                        <div>
                            <div className="flex justify-between items-center mb-4 border-b border-slate-200 dark:border-[#12151C] pb-2">
                                <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-900 dark:text-[#F3F4F6]">
                                    REGISTRO DE PILOTOS
                                </h2>
                                <button
                                    type="button"
                                    onClick={fetchPilots}
                                    className="text-xs text-slate-400 hover:text-slate-900 dark:hover:text-white font-mono bg-transparent border-0 cursor-pointer uppercase"
                                >
                                    ACTUALIZAR
                                </button>
                            </div>

                            <div className="border border-slate-200 dark:border-[#12151C] rounded-none overflow-hidden">
                                <table className="w-full text-left border-collapse font-mono text-xs">
                                    <thead>
                                        <tr className="bg-slate-50 dark:bg-[#07090D] border-b border-slate-200 dark:border-[#12151C] text-slate-500 dark:text-[#8A93A6] uppercase tracking-wider text-[11px]">
                                            <th className="py-3 px-4 font-normal">ID CUENTA</th>
                                            <th className="py-3 px-4 font-normal">COLABORADOR</th>
                                            <th className="py-3 px-4 font-normal">ORGANIZACIÓN</th>
                                            <th className="py-3 px-4 font-normal">PROPÓSITO</th>
                                            <th className="py-3 px-4 font-normal">ESTADO</th>
                                            <th className="py-3 px-4 font-normal text-right">ACCIÓN</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200 dark:divide-[#12151C] tabular-nums">
                                        {pilotsLoading ? (
                                            <tr>
                                                <td colSpan={6} className="py-6 text-center text-slate-400 font-mono">[Cargando registros...]</td>
                                            </tr>
                                        ) : pilots.length === 0 ? (
                                            <tr>
                                                <td colSpan={6} className="py-6 text-center text-slate-400 font-mono">[Sin cuentas piloto registradas]</td>
                                            </tr>
                                        ) : (
                                            pilots.map((p) => (
                                                <tr key={p.id} className="hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                                                    <td className="py-3 px-4 text-[#00AEEF] select-text">{p.id}</td>
                                                    <td className="py-3 px-4">
                                                        <span className="block font-bold text-slate-900 dark:text-white">{p.collaboratorName}</span>
                                                        <span className="text-[11px] text-slate-500 dark:text-[#8A93A6] select-text">{p.collaboratorEmail}</span>
                                                    </td>
                                                    <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{p.organization || '-'}</td>
                                                    <td className="py-3 px-4 text-slate-500 dark:text-[#8A93A6] max-w-xs truncate">{p.purpose}</td>
                                                    <td className="py-3 px-4">
                                                        <span className={`px-1.5 py-0.5 text-[10px] font-mono ${
                                                            p.status === 'ACTIVE'
                                                                ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30'
                                                                : 'bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/30'
                                                        }`}>
                                                            {p.status}
                                                        </span>
                                                    </td>
                                                    <td className="py-3 px-4 text-right">
                                                        {p.status === 'ACTIVE' && (
                                                            <button
                                                                type="button"
                                                                onClick={() => handleRevokePilot(p.id)}
                                                                className="bg-transparent border-0 text-red-500 hover:text-red-700 text-xs font-mono uppercase cursor-pointer"
                                                            >
                                                                REVOCAR
                                                            </button>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                )}

                {/* CONTENIDO 2: SIMULACIÓN DE CLIENTE */}
                {activeSection === 'IMPERSONATE' && (
                    <div className="border border-slate-200 dark:border-[#12151C] p-6 rounded-none bg-[#F8FAFC] dark:bg-[#07090D] max-w-2xl">
                        <h2 className="text-xs font-mono font-bold uppercase tracking-wider mb-4 text-[#C68346]">
                            CONSOLA DE SIMULACIÓN DE CLIENTE (IMPERSONATION)
                        </h2>
                        <p className="text-xs text-slate-500 dark:text-[#8A93A6] font-mono mb-6">
                            Permite autenticar de forma efímera como tenant objetivo para auditar vistas operativas y permisos B2B.
                        </p>

                        <div className="flex flex-col sm:flex-row gap-4 items-end">
                            <div className="flex-1 w-full">
                                <label className="block text-xs uppercase tracking-wider text-slate-500 dark:text-[#8A93A6] mb-1 font-mono">
                                    CUENTA OBJETIVO
                                </label>
                                <select
                                    value={selectedTargetAccount}
                                    onChange={(e) => setSelectedTargetAccount(e.target.value)}
                                    className="w-full bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#12151C] px-3 py-2 text-xs font-mono focus:outline-none focus:border-[#C68346] rounded-none"
                                >
                                    <option value="dev-master-sandbox">dev-master-sandbox (Workspace DEV)</option>
                                    {pilots.filter(p => p.status === 'ACTIVE').map(p => (
                                        <option key={p.id} value={p.accountId}>{p.collaboratorName} ({p.organization || p.id})</option>
                                    ))}
                                </select>
                            </div>

                            <button
                                type="button"
                                onClick={handleLaunchImpersonation}
                                disabled={impersonateLoading}
                                className="bg-[#C68346] hover:bg-[#b0743e] text-white font-mono font-bold uppercase tracking-wider text-xs py-2.5 px-6 transition-colors rounded-none disabled:opacity-50 cursor-pointer"
                            >
                                {impersonateLoading ? 'INICIANDO...' : 'SIMULAR'}
                            </button>
                        </div>
                    </div>
                )}

                {/* CONTENIDO 3: CONFIGURACIÓN B2B EMPRESA */}
                {activeSection === 'B2B_EMPRESA' && (
                    <div className="border border-slate-200 dark:border-[#12151C] p-6 rounded-none bg-[#F8FAFC] dark:bg-[#07090D] max-w-3xl space-y-4 font-mono text-xs">
                        <div className="flex justify-between items-center border-b border-slate-200 dark:border-[#12151C] pb-3">
                            <span className="text-[#C68346] font-bold uppercase">FICHA INSTITUCIONAL B2B</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-slate-600 dark:text-slate-300">
                            <div><span className="text-slate-400">RUT / TAX ID:</span> 76.543.210-K</div>
                            <div><span className="text-slate-400">GIRO:</span> Extracción y beneficio de minerales</div>
                            <div><span className="text-slate-400">FAENA PRINCIPAL:</span> Planta Concentradora Cordillera</div>
                            <div><span className="text-slate-400">REGIÓN:</span> southamerica-west1 (Santiago)</div>
                        </div>
                        <div className="pt-4 flex gap-3">
                            <button
                                type="button"
                                onClick={() => navigate('/b2b/empresa')}
                                className="bg-[#C68346] hover:bg-[#b0743e] text-white font-mono font-bold uppercase text-xs py-2 px-4 rounded-none cursor-pointer"
                            >
                                ABRIR CONFIGURACIÓN DE EMPRESA
                            </button>
                        </div>
                    </div>
                )}

                {/* CONTENIDO 4: STAFF */}
                {activeSection === 'STAFF' && (
                    <div className="border border-slate-200 dark:border-[#12151C] p-6 rounded-none bg-[#F8FAFC] dark:bg-[#07090D] max-w-3xl space-y-4 font-mono text-xs">
                        <div className="flex justify-between items-center border-b border-slate-200 dark:border-[#12151C] pb-3">
                            <span className="text-[#C68346] font-bold uppercase">PERSONAL OPERATIVO</span>
                        </div>
                        <p className="text-slate-500 dark:text-[#8A93A6]">
                            Gobernanza de personal de terreno, roles biométricos Passkeys y credenciales de acceso operativo.
                        </p>
                        <div className="pt-2">
                            <button
                                type="button"
                                onClick={() => navigate('/staff')}
                                className="bg-[#C68346] hover:bg-[#b0743e] text-white font-mono font-bold uppercase text-xs py-2 px-4 rounded-none cursor-pointer"
                            >
                                GESTIONAR STAFF EN TERRENO
                            </button>
                        </div>
                    </div>
                )}

                {/* CONTENIDO 5: PERFILES DE CARGO */}
                {activeSection === 'JOB_PROFILES' && (
                    <div className="border border-slate-200 dark:border-[#12151C] p-6 rounded-none bg-[#F8FAFC] dark:bg-[#07090D] max-w-3xl space-y-4 font-mono text-xs">
                        <div className="flex justify-between items-center border-b border-slate-200 dark:border-[#12151C] pb-3">
                            <span className="text-[#C68346] font-bold uppercase">MATRIZ DE CARGOS Y COMPETENCIAS</span>
                        </div>
                        <p className="text-slate-500 dark:text-[#8A93A6]">
                            Definición técnica de perfiles de faena, exigencias normativas ISO 9001/45001 y matriz de competencias.
                        </p>
                        <div className="pt-2">
                            <button
                                type="button"
                                onClick={() => navigate('/job-profiles')}
                                className="bg-[#C68346] hover:bg-[#b0743e] text-white font-mono font-bold uppercase text-xs py-2 px-4 rounded-none cursor-pointer"
                            >
                                ABRIR MATRIZ DE CARGOS
                            </button>
                        </div>
                    </div>
                )}

                {/* CONTENIDO 6: ADMINISTRADORES */}
                {activeSection === 'B2B_ADMINS' && (
                    <div className="space-y-6 max-w-3xl font-mono text-xs">
                        <div className="border border-slate-200 dark:border-[#12151C] p-6 rounded-none bg-[#F8FAFC] dark:bg-[#07090D] space-y-4">
                            <div className="flex justify-between items-center border-b border-slate-200 dark:border-[#12151C] pb-3">
                                <span className="text-[#C68346] font-bold uppercase">GOBERNANZA DE ADMINISTRADORES</span>
                            </div>
                            <p className="text-slate-500 dark:text-[#8A93A6]">
                                Control de cuentas con privilegios elevados, autenticación por doble factor y rotación obligatoria de credenciales.
                            </p>
                            <div className="pt-2 flex flex-wrap gap-3">
                                <button
                                    type="button"
                                    onClick={() => navigate('/b2b/admins')}
                                    className="bg-[#C68346] hover:bg-[#b0743e] text-white font-mono font-bold uppercase text-xs py-2 px-4 rounded-none cursor-pointer"
                                >
                                    ADMINISTRAR PRIVILEGIOS
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setActiveSection('BRANDING')}
                                    className="border border-[#C68346] text-[#C68346] hover:bg-[#C68346] hover:text-white font-mono font-bold uppercase text-xs py-2 px-4 rounded-none cursor-pointer transition-colors flex items-center gap-1.5"
                                >
                                    <span className="material-symbols-outlined text-[16px]">palette</span>
                                    GESTOR DE LOGOS
                                </button>
                            </div>
                        </div>

                        {/* Acceso Rápido Integrado a Gestor de Logos */}
                        <div className="border border-slate-200 dark:border-[#12151C] p-6 rounded-none bg-[#FFFFFF] dark:bg-[#07090D] space-y-4">
                            <div className="flex justify-between items-center border-b border-slate-200 dark:border-[#12151C] pb-3">
                                <div className="flex items-center gap-2">
                                    <span className="material-symbols-outlined text-[#C68346] text-[18px]">palette</span>
                                    <span className="text-slate-900 dark:text-[#F3F4F6] font-bold uppercase">IDENTIDAD CORPORATIVA</span>
                                </div>
                            </div>
                            <p className="text-slate-500 dark:text-[#8A93A6]">
                                Administración oficial de isotipos, logotipos, imagotipos y empaquetado móvil PWA/Android.
                            </p>
                            <div className="pt-2">
                                <button
                                    type="button"
                                    onClick={() => setActiveSection('BRANDING')}
                                    className="bg-[#C68346] hover:bg-[#b0743e] text-white font-mono font-bold uppercase text-xs py-2 px-4 rounded-none cursor-pointer flex items-center gap-2"
                                >
                                    <span className="material-symbols-outlined text-[16px]">tune</span>
                                    CONFIGURAR LOGOS DEL SISTEMA
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* CONTENIDO 7: GESTOR DE LOGOS & IDENTIDAD */}
                {activeSection === 'BRANDING' && (
                    <div className="max-w-5xl">
                        <BrandingManager />
                    </div>
                )}

                {/* CONTENIDO 7: MÉTRICAS */}
                {activeSection === 'B2B_METRICAS' && (
                    <div className="border border-slate-200 dark:border-[#12151C] p-6 rounded-none bg-[#F8FAFC] dark:bg-[#07090D] max-w-3xl space-y-4 font-mono text-xs">
                        <div className="flex justify-between items-center border-b border-slate-200 dark:border-[#12151C] pb-3">
                            <span className="text-[#C68346] font-bold uppercase">TELEMETRÍA & AUDITORÍA</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                            <div className="border border-slate-200 dark:border-[#12151C] p-3">
                                <span className="text-slate-400 block text-[10px]">CORE WEB VITALS</span>
                                <span className="text-emerald-500 font-bold">LCP &lt; 1.0s</span>
                            </div>
                            <div className="border border-slate-200 dark:border-[#12151C] p-3">
                                <span className="text-slate-400 block text-[10px]">INP</span>
                                <span className="text-emerald-500 font-bold">&lt; 50ms</span>
                            </div>
                            <div className="border border-slate-200 dark:border-[#12151C] p-3">
                                <span className="text-slate-400 block text-[10px]">OFFLINE QUEUE</span>
                                <span className="text-[#00AEEF] font-bold">ACTIVO (IndexedDB)</span>
                            </div>
                        </div>
                        <div className="pt-2">
                            <button
                                type="button"
                                onClick={() => navigate('/b2b/metricas')}
                                className="bg-[#C68346] hover:bg-[#b0743e] text-white font-mono font-bold uppercase text-xs py-2 px-4 rounded-none cursor-pointer"
                            >
                                VER CONSOLA DE MÉTRICAS
                            </button>
                        </div>
                    </div>
                )}

                {/* CONTENIDO 8: SUSCRIPCIÓN */}
                {activeSection === 'B2B_SUSCRIPCION' && (
                    <div className="border border-slate-200 dark:border-[#12151C] p-6 rounded-none bg-[#F8FAFC] dark:bg-[#07090D] max-w-3xl space-y-4 font-mono text-xs">
                        <div className="flex justify-between items-center border-b border-slate-200 dark:border-[#12151C] pb-3">
                            <span className="text-[#C68346] font-bold uppercase">ESTADO DE LICENCIAMIENTO INDUSTRIAL</span>
                        </div>
                        <div className="space-y-2 text-slate-600 dark:text-slate-300">
                            <div>• STOCKPILE (Cubicaciones & Gemelo 3D): <span className="text-emerald-500 font-bold">HABILITADO</span></div>
                            <div>• OPERMAQ (Telemetría & Flota Pesada): <span className="text-emerald-500 font-bold">HABILITADO</span></div>
                        </div>
                        <div className="pt-2">
                            <button
                                type="button"
                                onClick={() => navigate('/b2b/suscripcion')}
                                className="bg-[#C68346] hover:bg-[#b0743e] text-white font-mono font-bold uppercase text-xs py-2 px-4 rounded-none cursor-pointer"
                            >
                                GESTIONAR SUSCRIPCIÓN
                            </button>
                        </div>
                    </div>
                )}

                {/* MÓDULO INDUSTRIAL 1: STOCKPILE (NATIVO EN VIVO) */}
                {activeSection === 'MODULE_STOCKPILE' && (
                    <div className="w-full h-full flex-1 flex flex-col">
                        <Suspense fallback={
                            <div className="p-12 text-center font-mono text-xs flex flex-col items-center justify-center gap-2">
                                <span className="material-symbols-outlined text-2xl text-[#C68346] animate-spin">progress_activity</span>
                                <span className="text-[10px] uppercase text-slate-400">Cargando Módulo Stockpile (Capa 2)...</span>
                            </div>
                        }>
                            <StockpileModule />
                        </Suspense>
                    </div>
                )}

                {/* MÓDULO INDUSTRIAL 2: OPERMAQ (NATIVO EN VIVO) */}
                {activeSection === 'MODULE_OPERMAQ' && (
                    <div className="w-full h-full flex-1 flex flex-col">
                        <Suspense fallback={
                            <div className="p-12 text-center font-mono text-xs flex flex-col items-center justify-center gap-2">
                                <span className="material-symbols-outlined text-2xl text-[#C68346] animate-spin">progress_activity</span>
                                <span className="text-[10px] uppercase text-slate-400">Cargando Módulo Opermaq (Capa 2)...</span>
                            </div>
                        }>
                            <OpermaqModule />
                        </Suspense>
                    </div>
                )}

            </main>

        </div>
    );
};

export default DevVaultGateway;
