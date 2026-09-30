import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { 
    signInWithEmailAndPassword, 
    signInWithPopup, 
    GoogleAuthProvider 
} from 'firebase/auth';
import { auth } from '../config/firebase';
import BrandLogo from '../components/BrandLogo';

export const Login: React.FC = () => {
    const navigate = useNavigate();
    
    // Estados estrictos y limpios (sin pre-llenados)
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Login con Correo y Contraseña
    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setLoading(true);

        try {
            await signInWithEmailAndPassword(auth, email.trim(), password);
            navigate('/dashboard');
        } catch (err: any) {
            console.error('[AUTH] Login error:', err);
            if (
                err.code === 'auth/invalid-credential' || 
                err.code === 'auth/user-not-found' || 
                err.code === 'auth/wrong-password' ||
                err.code === 'auth/invalid-email'
            ) {
                setError('Credenciales corporativas inválidas o cuenta no registrada.');
            } else {
                setError(err.message || 'Error de conexión con el servicio de autenticación.');
            }
        } finally {
            setLoading(false);
        }
    };

    // Login con Google
    const handleGoogleLogin = async () => {
        setError(null);
        setLoading(true);
        const provider = new GoogleAuthProvider();

        try {
            await signInWithPopup(auth, provider);
            navigate('/dashboard');
        } catch (err: any) {
            console.error('[AUTH] Google Sign-In error:', err);
            setError('No se pudo completar el acceso con Google.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#030406] text-[#F3F4F6] flex flex-col items-center justify-center p-6 antialiased font-sans select-none">
            
            {/* Contenedor Minimalista Centrado */}
            <div className="w-full max-w-sm mx-auto space-y-8">
                
                {/* Identidad Oficial: Isotipo arriba y Logotipo abajo */}
                <div className="flex flex-col items-center justify-center space-y-3">
                    <BrandLogo variant="isotype" forcedTheme="dark" className="h-16 w-auto object-contain filter invert brightness-200 contrast-125" />
                    <BrandLogo variant="logotype" forcedTheme="dark" className="h-5 w-auto object-contain filter invert brightness-200 contrast-125" />
                </div>

                {/* Formulario de Acceso Directo */}
                <div className="bg-[#07090D] border border-[#12151C] p-8 shadow-2xl space-y-6">
                    
                    {/* Alerta de Error Aséptica */}
                    {error && (
                        <div className="p-3 bg-red-950/20 border border-red-900/60 text-red-400 text-xs flex items-center gap-2 font-mono">
                            <span className="material-symbols-outlined text-[16px] text-red-400 shrink-0">
                                error
                            </span>
                            <span>{error}</span>
                        </div>
                    )}

                    {/* Botón Google Workspace */}
                    <button
                        type="button"
                        onClick={handleGoogleLogin}
                        disabled={loading}
                        className="w-full py-2.5 px-4 bg-white/5 hover:bg-white/10 border border-[#12151C] hover:border-neutral-700 text-xs font-mono text-[#F3F4F6] transition-colors flex items-center justify-center gap-3 disabled:opacity-50 cursor-pointer"
                    >
                        <svg className="w-4 h-4" viewBox="0 0 24 24">
                            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                        </svg>
                        <span>Continuar con Google</span>
                    </button>

                    {/* Divisor */}
                    <div className="relative flex items-center justify-center my-2">
                        <div className="border-t border-[#12151C] w-full" />
                        <span className="bg-[#07090D] px-2 text-[9px] text-[#5A6072] uppercase font-mono tracking-widest absolute">
                            O
                        </span>
                    </div>

                    {/* Formulario Correo + Contraseña */}
                    <form onSubmit={handleLogin} className="space-y-4" autoComplete="off" spellCheck={false}>
                        <div>
                            <label className="block text-xs font-mono text-[#8A93A6] mb-1.5">
                                Correo Corporativo
                            </label>
                            <input
                                type="email"
                                name="minreport_user_email"
                                id="minreport_user_email"
                                required
                                value={email}
                                onChange={e => setEmail(e.target.value)}
                                placeholder="correo@empresa.com"
                                autoComplete="off"
                                autoCorrect="off"
                                autoCapitalize="off"
                                spellCheck={false}
                                className="w-full bg-[#000000] border border-[#12151C] focus:border-[#C68346] text-[#F3F4F6] placeholder-[#5A6072] px-3 py-2 text-xs font-mono outline-none transition-colors"
                            />
                        </div>

                        <div>
                            <label className="block text-xs font-mono text-[#8A93A6] mb-1.5">
                                Contraseña
                            </label>
                            <div className="relative">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    name="minreport_user_password"
                                    id="minreport_user_password"
                                    required
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    placeholder="••••••••••••"
                                    autoComplete="new-password"
                                    spellCheck={false}
                                    className="w-full bg-[#000000] border border-[#12151C] focus:border-[#C68346] text-[#F3F4F6] placeholder-[#5A6072] pl-3 pr-10 py-2 text-xs font-mono outline-none transition-colors"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-2 top-2 p-1 bg-transparent border-0 outline-none text-[#5A6072] hover:text-[#F3F4F6] transition-colors cursor-pointer"
                                    tabIndex={-1}
                                    title={showPassword ? 'Ocultar' : 'Mostrar'}
                                >
                                    <span className="material-symbols-outlined text-[16px]">
                                        {showPassword ? 'visibility_off' : 'visibility'}
                                    </span>
                                </button>
                            </div>
                        </div>

                        {/* Botón Principal Iniciar Sesión */}
                        <button
                            type="submit"
                            disabled={loading}
                            className="w-full py-2.5 px-4 bg-[#C68346] hover:opacity-90 active:scale-[0.99] text-white text-xs font-mono font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 disabled:opacity-50 cursor-pointer shadow-sm mt-6"
                        >
                            <span>{loading ? 'Accediendo...' : 'Iniciar Sesión'}</span>
                            {!loading && (
                                <span className="material-symbols-outlined text-[16px]">
                                    login
                                </span>
                            )}
                        </button>
                    </form>
                </div>

                {/* Enlace Secundario Sobrio */}
                <div className="text-center">
                    <Link
                        to="/register"
                        className="text-[11px] font-mono text-[#8A93A6] hover:text-[#F3F4F6] transition-colors"
                    >
                        Registrar Cuenta Titular B2B
                    </Link>
                </div>
            </div>
        </div>
    );
};

export default Login;
