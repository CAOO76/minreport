import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword, signInWithCustomToken } from 'firebase/auth';
import { auth } from '../config/firebase';
import { formatRut } from '../utils/rut';
import { useAuth } from '../context/AuthContext';
import { getApiUrl } from '../utils/network';
import BrandLogo from '../components/BrandLogo';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { isPasskeySupported, registerPasskey } from '../services/passkeyService';

export const SetupAccess: React.FC = () => {
    const navigate = useNavigate();
    const { signOut } = useAuth();
    const [searchParams] = useSearchParams();

    const accountId = searchParams.get('accountId');
    const token = searchParams.get('token');
    const urlTaxId = searchParams.get('taxId');
    const name = searchParams.get('name') || '';
    const accountName = searchParams.get('accountName') || '';

    const [taxId, setTaxId] = useState(urlTaxId ? formatRut(urlTaxId) : '');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [passkeyEnrolling, setPasskeyEnrolling] = useState(false);
    const [passkeyDone, setPasskeyDone] = useState(false);
    const [setupResponseToken, setSetupResponseToken] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const passkeyAvailable = isPasskeySupported();

    useEffect(() => {
        if (!accountId || !token) {
            setError('Enlace de activacion invalido o expirado. Verifique el enlace enviado a su correo.');
        }
    }, [accountId, token]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!taxId || taxId.trim().length < 8) {
            setError('Ingrese un RUT/RUN valido para verificar su identidad.');
            return;
        }

        if (password !== confirmPassword) {
            setError('Las contraseñas no coinciden.');
            return;
        }

        if (password.length < 8) {
            setError('La contraseña debe tener al menos 8 caracteres.');
            return;
        }

        setLoading(true);
        setError('');

        try {
            const response = await fetch(getApiUrl('/api/auth/tunnel/setup-password'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taxId: taxId.replace(/[^0-9Kk]/g, '').toUpperCase(),
                    accountId,
                    token,
                    password
                }),
            });

            const data = await response.json().catch(() => ({}));

            if (!response.ok) {
                throw new Error(data.error || 'Fallo al establecer credenciales');
            }

            if (data.customToken) {
                setSetupResponseToken(data.customToken);
            }
            setSuccess(true);

            if (!passkeyAvailable) {
                window.setTimeout(async () => {
                    await signOut();
                    navigate('/login', { replace: true });
                }, 2000);
            }
        } catch (err: any) {
            console.error('[SETUP] Fallo en configuracion:', err);
            setError(err.message || 'Error de conexion con el servicio de seguridad.');
        } finally {
            setLoading(false);
        }
    };

    const handleOptionalPasskeyEnroll = async () => {
        setError('');
        setPasskeyEnrolling(true);
        try {
            let activeUser = auth.currentUser;
            if (!activeUser && setupResponseToken) {
                const cred = await signInWithCustomToken(auth, setupResponseToken);
                activeUser = cred.user;
            }
            if (!activeUser) {
                const cleanTax = taxId.replace(/[^0-9Kk]/g, '').toUpperCase();
                const dirRes = await fetch(getApiUrl(`/api/public/accounts-by-id/${encodeURIComponent(cleanTax)}`));
                if (dirRes.ok) {
                    const dirData = await dirRes.json();
                    const matched = (dirData.accounts || []).find((a: any) => a.accountId === accountId) || dirData.accounts?.[0];
                    if (matched?.authEmail) {
                        const cred = await signInWithEmailAndPassword(auth, matched.authEmail, password);
                        activeUser = cred.user;
                    }
                }
            }

            if (!activeUser) {
                throw new Error('Inicie sesion en /login para completar la vinculacion de Passkey.');
            }

            const idToken = await activeUser.getIdToken();
            await registerPasskey(idToken, 'Terminal Operativa MINREPORT');
            setPasskeyDone(true);
            window.setTimeout(() => {
                navigate('/dashboard', { replace: true });
            }, 1200);
        } catch (err: any) {
            if (err?.name !== 'NotAllowedError') {
                setError(err?.message || 'No se pudo registrar Passkey FIDO2 en este dispositivo.');
            }
        } finally {
            setPasskeyEnrolling(false);
        }
    };

    const handleContinueToLogin = async () => {
        await signOut();
        navigate('/login', { replace: true });
    };

    if (success) {
        return (
            <div className="min-h-screen bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6] flex items-center justify-center p-fib-21 font-sans select-none">
                <div className="w-full max-w-md p-fib-34 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] text-center space-y-fib-21 rounded-none shadow-none">
                    <span className="material-symbols-outlined text-[32px] text-[#00AEEF]">verified</span>
                    <div>
                        <h2 className="text-h1-header uppercase tracking-tight text-[#0F172A] dark:text-[#F3F4F6]">
                            Credenciales Establecidas
                        </h2>
                        <p className="text-xs text-[#475569] dark:text-[#8A93A6] mt-2 leading-relaxed">
                            {passkeyDone
                                ? 'Passkey FIDO2 vinculada correctamente. Ingresando al entorno operativo...'
                                : 'Su clave operativa fue registrada. Opcionalmente puede vincular autenticacion biometrica FIDO2 en este equipo.'}
                        </p>
                    </div>

                    {error && (
                        <div className="p-fib-13 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-mono text-left rounded-none">
                            {error}
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
                                    {passkeyEnrolling ? 'progress_activity' : 'fingerprint'}
                                </span>
                                <span>{passkeyEnrolling ? 'Vinculando Passkey...' : 'Vincular Passkey FIDO2 (Opcional)'}</span>
                            </button>
                            <button
                                type="button"
                                onClick={handleContinueToLogin}
                                disabled={passkeyEnrolling}
                                className="w-full py-2.5 bg-transparent border border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346] text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-[#F3F4F6] text-xs font-mono uppercase tracking-wider rounded-none cursor-pointer"
                            >
                                Ir a Inicio de Sesion
                            </button>
                        </div>
                    )}
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
                            <span className="text-[10px] text-[#475569] dark:text-[#8A93A6] block font-mono">CONTROL DE ACCESO E IDENTIDAD</span>
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
                        <span>ACTIVACION DE CREDENCIALES OPERATIVAS</span>
                    </div>

                    <h1 className="text-hero-display uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                        Configuracion de Acceso Corporativo
                    </h1>

                    <p className="text-body-main text-[#475569] dark:text-[#8A93A6]">
                        Verifique su RUN/RUT registrado en la nomina de la organizacion y establezca su clave personal de acceso.
                    </p>

                    {accountName && (
                        <div className="p-fib-21 bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] flex items-center gap-fib-13 rounded-none shadow-none">
                            <span className="material-symbols-outlined text-[20px] text-[#C68346] shrink-0">apartment</span>
                            <div>
                                <span className="text-microcopy text-[#475569] dark:text-[#8A93A6] uppercase block">Organizacion Asignada</span>
                                <span className="text-sm font-bold text-[#0F172A] dark:text-[#F3F4F6] uppercase">{decodeURIComponent(accountName)}</span>
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex items-center justify-between text-[11px] text-[#94A3B8] dark:text-[#5A6072] font-mono border-t border-[#E2E8F0] dark:border-[#12151C] pt-4">
                    <span>DS 132 REGLAMENTO DE SEGURIDAD MINERA</span>
                    <span>REGION SOUTHAMERICA-WEST1</span>
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
                            REGISTRO DE IDENTIDAD
                        </span>
                        <h2 className="text-h1-header uppercase text-[#0F172A] dark:text-[#F3F4F6] mt-1">
                            {name ? decodeURIComponent(name) : 'Establecer Contraseña'}
                        </h2>
                        <p className="text-xs text-[#475569] dark:text-[#8A93A6] mt-1">
                            Confirme su identificador tributario/personal y defina su clave de acceso.
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-4" autoComplete="off" spellCheck={false}>
                        <div>
                            <label className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] mb-1.5 font-mono">
                                RUN / RUT del Usuario
                            </label>
                            <input
                                type="text"
                                required
                                autoComplete="off"
                                spellCheck={false}
                                value={taxId}
                                onChange={(e) => setTaxId(formatRut(e.target.value))}
                                placeholder="12.345.678-9"
                                className="w-full px-3.5 py-2.5 bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-sm text-[#0F172A] dark:text-[#F3F4F6] font-mono tabular-nums outline-none transition-colors rounded-none select-text"
                            />
                        </div>

                        <div>
                            <label className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] mb-1.5 font-mono">
                                Nueva Contraseña Operativa (min 8 caracteres)
                            </label>
                            <div className="relative">
                                <input
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
                                    title={showPassword ? 'Ocultar clave' : 'Mostrar clave'}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                >
                                    <span className="material-symbols-outlined text-[18px]">
                                        {showPassword ? 'visibility_off' : 'visibility'}
                                    </span>
                                </button>
                            </div>
                        </div>

                        <div>
                            <label className="block text-microcopy uppercase text-[#475569] dark:text-[#8A93A6] mb-1.5 font-mono">
                                Confirmar Contraseña
                            </label>
                            <input
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

                        {error && (
                            <div className="p-fib-13 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-mono rounded-none">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading || !token || !accountId}
                            className="w-full py-3 bg-[#C68346] hover:bg-[#B0743E] text-white text-xs font-mono font-bold uppercase tracking-[0.15em] flex items-center justify-center gap-2 transition-colors disabled:opacity-50 mt-2 rounded-none shadow-none border-0 cursor-pointer"
                        >
                            {loading ? (
                                <span className="material-symbols-outlined animate-spin text-[16px] text-white">progress_activity</span>
                            ) : (
                                <span>Activar y Confirmar Clave</span>
                            )}
                        </button>
                    </form>
                </div>

                <div className="border-t border-[#E2E8F0] dark:border-[#12151C] pt-4 text-center">
                    <p className="text-[10px] text-[#94A3B8] dark:text-[#5A6072] font-mono uppercase tracking-wider">
                        MINREPORT · IDENTIDAD VERIFICADA
                    </p>
                </div>
            </div>
        </div>
    );
};

export default SetupAccess;
