import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../../config/firebase';
import { LanguageSwitch } from '../../components/LanguageSwitch';
import { ThemeSwitch } from '../../components/ThemeSwitch';
import BrandLogo from '../../components/BrandLogo';

export const MobileLogin: React.FC = () => {
    const navigate = useNavigate();

    // Estados de Formulario
    const [identifier, setIdentifier] = useState(''); // Email o RUT
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const resolveApiUrl = (endpoint: string) => {
        const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
        return `http://${host}:8080${endpoint}`;
    };

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);

        const cleanInput = identifier.trim().toLowerCase();

        // [DEV_ROOT SHIELD] Bloqueo de cuenta maestra en terminal móvil
        if (cleanInput === 'dev@minreport.com') {
            setLoading(false);
            setError('Credenciales corporativas inválidas o tipo de cuenta no autorizada en terminal móvil.');
            return;
        }

        try {
            let targetEmail = cleanInput;

            // Si no contiene '@', se asume que es un RUT y se resuelve su correo en el directorio
            if (!cleanInput.includes('@')) {
                const resp = await fetch(resolveApiUrl(`/api/public/accounts-by-id/${encodeURIComponent(cleanInput)}`));
                if (resp.ok) {
                    const data = await resp.json();
                    const firstAccount = data.accounts?.[0];
                    if (firstAccount?.authEmail) {
                        targetEmail = firstAccount.authEmail.toLowerCase().trim();
                    }
                }
            }

            // Autenticación oficial unificada con Firebase Auth
            await signInWithEmailAndPassword(auth, targetEmail, password);
            navigate('/mobile/dashboard');
        } catch (err: any) {
            console.error('[MOBILE-LOGIN] Error:', err);
            if (
                err.code === 'auth/invalid-credential' || 
                err.code === 'auth/user-not-found' || 
                err.code === 'auth/wrong-password' ||
                err.code === 'auth/invalid-email'
            ) {
                setError('Credenciales operativas inválidas o usuario no registrado.');
            } else {
                setError('Error de conexión con la infraestructura de autenticación.');
            }
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen w-full bg-white dark:bg-[#000000] text-slate-900 dark:text-[#F3F4F6] flex flex-col justify-between p-6 select-none font-sans antialiased">
            
            {/* Header Técnico */}
            <header className="flex items-center justify-between border-b border-slate-200 dark:border-[#12151C] pb-4">
                <div className="flex items-center gap-2">
                    <BrandLogo variant="isotype" className="h-6 w-auto object-contain" />
                    <span className="font-mono text-xs uppercase tracking-widest text-slate-800 dark:text-[#F3F4F6] font-bold">
                        MINREPORT MOBILE
                    </span>
                </div>

                <div className="flex items-center gap-2">
                    <LanguageSwitch />
                    <ThemeSwitch />
                </div>
            </header>

            {/* Contenedor Central */}
            <main className="w-full max-w-sm mx-auto my-auto space-y-6">
                <div className="space-y-1">
                    <h1 className="font-mono text-sm uppercase tracking-wider text-slate-900 dark:text-[#F3F4F6] font-bold">
                        Acceso Operativo de Faena
                    </h1>
                    <p className="font-sans text-xs text-slate-500 dark:text-[#8A93A6]">
                        Ingrese con su correo corporativo o RUT registrado
                    </p>
                </div>

                <form onSubmit={handleLogin} autoComplete="off" spellCheck={false} className="bg-slate-50 dark:bg-[#07090D] border border-slate-200 dark:border-[#12151C] p-6 space-y-4 rounded-none shadow-none">
                    
                    {error && (
                        <div className="p-3 bg-red-500/10 border border-red-500/30 text-red-600 dark:text-red-400 text-xs font-mono flex items-center gap-2 rounded-none">
                            <span className="material-symbols-outlined text-[16px] text-red-600 dark:text-red-400 shrink-0">
                                error
                            </span>
                            <span>{error}</span>
                        </div>
                    )}

                    <div>
                        <label className="block text-[11px] font-mono text-slate-600 dark:text-[#8A93A6] uppercase tracking-wider mb-1.5">
                            Correo Corporativo o RUT
                        </label>
                        <input
                            type="text"
                            value={identifier}
                            onChange={(e) => setIdentifier(e.target.value)}
                            placeholder="operador@minera.cl o 12.345.678-9"
                            required
                            autoFocus
                            className="w-full bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#12151C] focus:border-[#C68346] px-3 py-2 font-mono text-xs text-slate-900 dark:text-[#F3F4F6] outline-none rounded-none transition-colors"
                        />
                    </div>

                    <div>
                        <label className="block text-[11px] font-mono text-slate-600 dark:text-[#8A93A6] uppercase tracking-wider mb-1.5">
                            Contraseña
                        </label>
                        <div className="relative">
                            <input
                                type={showPassword ? 'text' : 'password'}
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="••••••••••••"
                                required
                                className="w-full bg-white dark:bg-[#000000] border border-slate-300 dark:border-[#12151C] focus:border-[#C68346] px-3 py-2 pr-10 font-mono text-xs text-slate-900 dark:text-[#F3F4F6] outline-none rounded-none transition-colors"
                            />
                            <button
                                type="button"
                                onClick={() => setShowPassword(!showPassword)}
                                className="absolute right-2.5 top-1/2 -translate-y-1/2 bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                            >
                                <span className="material-symbols-outlined text-[18px]">
                                    {showPassword ? 'visibility_off' : 'visibility'}
                                </span>
                            </button>
                        </div>
                    </div>

                    <button
                        type="submit"
                        disabled={loading}
                        className="w-full py-2.5 bg-[#C68346] hover:bg-[#b07238] text-black font-mono font-bold text-xs uppercase tracking-wider transition-colors disabled:opacity-50 cursor-pointer rounded-none outline-none flex items-center justify-center gap-2"
                    >
                        {loading ? (
                            <span>VALIDANDO...</span>
                        ) : (
                            <>
                                <span>INGRESAR A FAENA</span>
                                <span className="material-symbols-outlined text-[16px]">
                                    arrow_forward
                                </span>
                            </>
                        )}
                    </button>
                </form>
            </main>

            {/* Footer Técnico */}
            <footer className="border-t border-slate-200 dark:border-[#12151C] pt-4 text-center">
                <p className="font-mono text-[10px] text-slate-500 dark:text-[#5A6072] uppercase tracking-widest">
                    SISTEMA MINERO INTEGRADO MINREPORT
                </p>
            </footer>

        </div>
    );
};

export default MobileLogin;
