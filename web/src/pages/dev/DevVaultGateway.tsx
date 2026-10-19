import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { auth } from '../../config/firebase';
import { signInWithCustomToken } from 'firebase/auth';
import { ThemeSwitch } from '../../components/ThemeSwitch';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import BrandLogo from '../../components/BrandLogo';

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

export const DevVaultGateway: React.FC = () => {
    const navigate = useNavigate();

    // Estado Auth DEV - Campos estrictamente vacíos sin prellenado ni sugerencias
    const [isAuthenticated, setIsAuthenticated] = useState<boolean>(false);
    const [devToken, setDevToken] = useState<string>('');
    const [loginEmail, setLoginEmail] = useState<string>('');
    const [loginPassword, setLoginPassword] = useState<string>('');
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
        }
    }, []);

    useEffect(() => {
        if (isAuthenticated && devToken) {
            fetchPilots();
        }
    }, [isAuthenticated, devToken]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoginError(null);
        setLoginLoading(true);

        const cleanEmail = loginEmail.trim().toLowerCase();
        const cleanPassword = loginPassword;

        if (!cleanEmail || !cleanPassword) {
            setLoginError('Credenciales requeridas');
            setLoginLoading(false);
            return;
        }

        try {
            const resp = await fetch(`${apiBase}/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: cleanEmail, password: cleanPassword })
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
                    await signInWithCustomToken(auth, data.firebaseToken);
                } catch (fbErr) {
                    console.warn('[DEV] Firebase sync warning:', fbErr);
                }
            }
        } catch (err: any) {
            setLoginError(err.message || 'Credenciales inválidas');
        } finally {
            setLoginLoading(false);
        }
    };

    const handleLogout = async () => {
        localStorage.removeItem('dev_auth_token');
        localStorage.removeItem('dev_vault_token');
        localStorage.removeItem('dev_is_impersonating');
        localStorage.removeItem('dev_impersonated_account');
        setDevToken('');
        setLoginEmail('');
        setLoginPassword('');
        setIsAuthenticated(false);
        try {
            await auth.signOut();
        } catch { }
    };

    const fetchPilots = async () => {
        setPilotsLoading(true);
        try {
            const resp = await fetch(`${apiBase}/test-pilots`, {
                headers: { 'Authorization': `Bearer ${devToken}` }
            });
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
            const resp = await fetch(`${apiBase}/test-pilots`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${devToken}`
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
            const resp = await fetch(`${apiBase}/test-pilots/${id}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${devToken}` }
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
            const resp = await fetch(`${apiBase}/impersonate-client`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${devToken}`
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
    // VISTA 1: ACCESO DEV MINIMALISTA PURO (CAMPOS EN BLANCO, SIN REVELACIÓN)
    // =========================================================================
    if (!isAuthenticated) {
        return (
            <div className="min-h-screen bg-white dark:bg-[#000000] text-slate-900 dark:text-[#F3F4F6] flex flex-col items-center justify-center p-6 antialiased select-none font-sans">
                
                {/* Controles Flotantes Superior */}
                <div className="absolute top-6 right-6 flex items-center gap-3 z-50">
                    <LanguageSwitch />
                    <ThemeSwitch />
                </div>

                <div className="w-full max-w-sm mx-auto space-y-6">
                    
                    {/* Logotipo Oficial MINREPORT */}
                    <div className="flex flex-col items-center justify-center space-y-3">
                        <BrandLogo variant="isotype" className="h-16 w-auto object-contain" />
                        <BrandLogo variant="logotype" className="h-5 w-auto object-contain" />
                    </div>

                    {/* Tarjeta de Acceso */}
                    <div className="bg-[#F8FAFC] dark:bg-[#07090D] border border-slate-200 dark:border-[#12151C] p-8 shadow-none rounded-none space-y-6">
                        
                        {loginError && (
                            <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-mono rounded-none">
                                {loginError}
                            </div>
                        )}

                        <form onSubmit={handleLogin} autoComplete="off" spellCheck={false} data-lpignore="true" data-form-type="other" className="space-y-4">
                            {/* Trampa anti-autofill del navegador para anular popups de credenciales guardadas */}
                            <input type="text" name="b_sink_u" style={{ display: 'none', position: 'absolute', opacity: 0, pointerEvents: 'none' }} tabIndex={-1} aria-hidden="true" autoComplete="off" />
                            <input type="password" name="b_sink_p" style={{ display: 'none', position: 'absolute', opacity: 0, pointerEvents: 'none' }} tabIndex={-1} aria-hidden="true" autoComplete="off" />

                            <div>
                                <label className="block text-[11px] font-mono text-slate-500 dark:text-[#8A93A6] mb-1.5 uppercase">
                                    USUARIO
                                </label>
                                <input
                                    type="text"
                                    inputMode="email"
                                    name="minreport_gate_uid"
                                    id="minreport_gate_uid"
                                    value={loginEmail}
                                    onChange={(e) => setLoginEmail(e.target.value)}
                                    required
                                    autoComplete="one-time-code"
                                    autoCorrect="off"
                                    autoCapitalize="off"
                                    spellCheck={false}
                                    data-lpignore="true"
                                    data-form-type="other"
                                    aria-autocomplete="none"
                                    placeholder=""
                                    className="w-full bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#12151C] focus:border-[#C68346] text-slate-900 dark:text-[#F3F4F6] px-3 py-2 text-xs font-mono outline-none rounded-none transition-colors"
                                />
                            </div>

                            <div>
                                <label className="block text-[11px] font-mono text-slate-500 dark:text-[#8A93A6] mb-1.5 uppercase">
                                    CLAVE
                                </label>
                                <input
                                    type="password"
                                    name="minreport_gate_sec"
                                    id="minreport_gate_sec"
                                    value={loginPassword}
                                    onChange={(e) => setLoginPassword(e.target.value)}
                                    placeholder=""
                                    required
                                    autoComplete="new-password"
                                    autoCorrect="off"
                                    autoCapitalize="off"
                                    spellCheck={false}
                                    data-lpignore="true"
                                    data-form-type="other"
                                    aria-autocomplete="none"
                                    className="w-full bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#12151C] focus:border-[#C68346] text-slate-900 dark:text-[#F3F4F6] px-3 py-2 text-xs font-mono outline-none rounded-none transition-colors"
                                />
                            </div>

                            <button
                                type="submit"
                                disabled={loginLoading}
                                className="w-full py-2.5 bg-[#C68346] hover:bg-[#b0743e] text-white font-mono font-bold text-xs uppercase tracking-wider transition-colors disabled:opacity-50 cursor-pointer rounded-none outline-none"
                            >
                                {loginLoading ? 'VALIDANDO...' : 'INGRESAR'}
                            </button>
                        </form>
                    </div>

                </div>
            </div>
        );
    }

    // =========================================================================
    // VISTA 2: PANEL DE CONTROL DEV (MINIMALISMO INDUSTRIAL PURO)
    // =========================================================================
    return (
        <div className="min-h-screen bg-white dark:bg-[#000000] text-slate-900 dark:text-[#F3F4F6] p-8 font-sans select-none antialiased">
            
            {/* Header Técnico Aséptico */}
            <div className="mb-8 border-b border-slate-200 dark:border-[#12151C] pb-6 flex justify-between items-end">
                <div className="flex items-center gap-4">
                    <BrandLogo variant="isotype" className="h-8 w-auto object-contain" />
                    <div>
                        <h1 className="text-xl font-bold tracking-tight uppercase font-sans text-slate-900 dark:text-[#F3F4F6]">
                            MINREPORT
                        </h1>
                        <p className="text-xs text-slate-500 dark:text-[#8A93A6] font-mono select-text">
                            ACCOUNT // DEV
                        </p>
                    </div>
                </div>

                <div className="flex items-center gap-6">
                    <div className="text-right">
                        <span className="text-[10px] uppercase tracking-widest text-[#C68346] font-bold font-mono">PILOTOS</span>
                        <p className="text-xl font-mono tabular-nums text-slate-900 dark:text-[#F3F4F6] font-bold">
                            {pilots.filter(p => p.status === 'ACTIVE').length}
                        </p>
                    </div>

                    <div className="flex items-center gap-2 border-l border-slate-200 dark:border-[#12151C] pl-6">
                        <LanguageSwitch />
                        <ThemeSwitch />
                        <button
                            type="button"
                            onClick={handleLogout}
                            className="bg-transparent border border-slate-300 dark:border-[#12151C] hover:border-red-500 text-slate-500 hover:text-red-500 px-3 py-1.5 text-xs font-mono uppercase tracking-wider transition-colors cursor-pointer rounded-none ml-2"
                        >
                            SALIR
                        </button>
                    </div>
                </div>
            </div>

            {/* Módulo 1: Simulación Cliente */}
            <div className="border border-slate-200 dark:border-[#12151C] p-6 rounded-none bg-[#F8FAFC] dark:bg-[#07090D] mb-8">
                <h2 className="text-xs font-mono font-bold uppercase tracking-wider mb-4 text-[#C68346]">
                    SIMULACIÓN CLIENTE
                </h2>

                <div className="flex flex-col sm:flex-row gap-4 items-end">
                    <div className="flex-1 w-full max-w-md">
                        <label className="block text-xs uppercase tracking-wider text-slate-500 dark:text-[#8A93A6] mb-1 font-mono">
                            CUENTA OBJETIVO
                        </label>
                        <select
                            value={selectedTargetAccount}
                            onChange={(e) => setSelectedTargetAccount(e.target.value)}
                            className="w-full bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#12151C] px-3 py-2 text-xs font-mono focus:outline-none focus:border-[#C68346] rounded-none"
                        >
                            <option value="dev-master-sandbox">dev-master-sandbox (Workspace DEV)</option>
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

            {/* Módulo 2: Alta TEST-PILOT */}
            <div className="border border-slate-200 dark:border-[#12151C] p-6 rounded-none bg-[#F8FAFC] dark:bg-[#07090D] mb-8">
                <h2 className="text-xs font-mono font-bold uppercase tracking-wider mb-4 text-slate-500 dark:text-[#8A93A6]">
                    TEST-PILOT // ALTA
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

            {/* Módulo 3: Tabla TEST-PILOT */}
            <div>
                <div className="flex justify-between items-center mb-4 border-b border-slate-200 dark:border-[#12151C] pb-2">
                    <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-slate-900 dark:text-[#F3F4F6]">
                        TEST-PILOT // REGISTROS
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
    );
};

export default DevVaultGateway;
