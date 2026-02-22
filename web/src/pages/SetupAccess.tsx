import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, Link } from 'react-router-dom';
import { Loader2, Lock, Eye, EyeOff, ShieldCheck, ArrowRight } from 'lucide-react';
import BrandLogo from '../components/BrandLogo';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { formatRut } from '../utils/rut';

export const SetupAccess = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    // Context from URL
    const accountId = searchParams.get('accountId');
    const email = searchParams.get('email');
    const name = searchParams.get('name') || '';
    const type = searchParams.get('type') || 'PERSONAL';

    // States
    const [taxId, setTaxId] = useState('');
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [bgImage, setBgImage] = useState('');

    useEffect(() => {
        if (!accountId) {
            setError('Enlace de activación inválido o expirado. Asegúrate de copiar el enlace completo desde tu correo.');
        }
    }, [accountId]);

    // Fetch UI Backgrounds for Industrial Look
    useEffect(() => {
        const fetchUI = async () => {
            try {
                const response = await fetch(`${import.meta.env.VITE_API_URL}/api/settings/ui-assets`);
                if (response.ok) {
                    const data = await response.json();
                    if (data.login_bg) setBgImage(data.login_bg);
                }
            } catch (err) {
                console.warn('UI Assets not available yet.');
            }
        };
        fetchUI();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!taxId || taxId.trim().length < 8) {
            setError('Ingresa un RUT/RUN válido para verificar tu identidad.');
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
            const apiBase = import.meta.env.VITE_API_URL || '';
            const response = await fetch(`${apiBase}/api/auth/tunnel/setup-password`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    taxId: taxId.replace(/[^0-9Kk]/g, '').toUpperCase(), // Send clean RUT
                    accountId,
                    password
                }),
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || 'Configuración fallida');
            }

            setSuccess(true);
            setTimeout(() => {
                navigate('/login', { replace: true });
            }, 3000);

        } catch (err: any) {
            console.error('Setup failed:', err);
            setError(err.message || 'Error de conexión. Intenta nuevamente.');
        } finally {
            setLoading(false);
        }
    };

    // --- RENDERIZADORES DE ICONOS MATERIAL ---
    const renderIcon = (type: string) => {
        switch (type.toUpperCase()) {
            case 'BUSINESS':
            case 'ENTERPRISE':
                return 'business';
            case 'EDUCATIONAL':
                return 'school';
            case 'PERSONAL':
                return 'person';
            default:
                return 'enhanced_encryption';
        }
    };

    if (success) {
        return (
            <div className="min-h-screen flex items-center justify-center p-4 transition-colors relative overflow-hidden industrial-mineral-gradient">
                {bgImage && (
                    <div className="absolute inset-0 z-0">
                        <img src={bgImage} alt="industrial atmosphere" className="w-full h-full object-cover brightness-[0.3] dark:brightness-[0.2]" />
                        <div className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"></div>
                    </div>
                )}
                <div className="w-full max-w-[400px] relative z-10 text-center text-black dark:text-white animate-in fade-in zoom-in-95 duration-700">
                    <div className="elite-tech-surface p-12 shadow-3xl flex flex-col items-center">
                        <div className="w-24 h-24 rounded-full bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center mb-6">
                            <span className="material-symbols-rounded text-[48px] text-emerald-500">check_circle</span>
                        </div>
                        <h2 className="text-2xl font-black uppercase tracking-tight mb-2">Clave Establecida</h2>
                        <p className="text-sm text-black/60 dark:text-white/60 mb-8">
                            Tu acceso seguro ha sido configurado correctamente. Transfiriendo a la consola central...
                        </p>
                        <Loader2 className="w-8 h-8 animate-spin text-antigravity-accent" />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center p-4 transition-colors relative overflow-hidden industrial-mineral-gradient">
            {/* Background Layer with mineral texture */}
            {bgImage && (
                <div className="absolute inset-0 z-0">
                    <img src={bgImage} alt="industrial atmosphere" className="w-full h-full object-cover brightness-[0.3] dark:brightness-[0.2]" />
                    <div className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"></div>
                </div>
            )}

            <div className="absolute top-6 right-6 flex items-center gap-3 z-50">
                <LanguageSwitch />
                <ThemeSwitch />
            </div>

            <div className="w-full max-w-[400px] relative z-10 transition-all duration-700 text-black dark:text-white">

                {/* Logo Flotante perfectamente alineado */}
                <div className="mb-6 px-10 flex justify-center">
                    <BrandLogo variant="isotype" className="w-1/4 h-auto relative z-10" />
                </div>

                <div className="flex items-center justify-center gap-4 mb-6 animate-in fade-in slide-in-from-top-4 duration-1000 delay-200">
                    <div className="h-[1px] w-8" style={{ backgroundColor: 'rgb(198, 131, 70)' }}></div>
                    <p className="hud-label" style={{ color: 'rgb(198, 131, 70)' }}>MINREPORT®</p>
                    <div className="h-[1px] w-8" style={{ backgroundColor: 'rgb(198, 131, 70)' }}></div>
                </div>

                <div className="elite-tech-surface p-12 animate-in fade-in zoom-in-95 duration-700 w-full shadow-3xl">
                    <div className="absolute inset-0 technical-grid opacity-20 pointer-events-none"></div>

                    <div className="text-center mb-10 relative z-10">
                        <div className="w-20 h-20 bg-white/5 text-white border border-white/10 flex items-center justify-center mx-auto mb-6 shadow-2xl relative overflow-hidden">
                            <div className="absolute inset-0 technical-grid opacity-10"></div>
                            <span className="material-symbols-rounded text-[40px] relative z-10">
                                {renderIcon(type)}
                            </span>
                        </div>
                        <p className="hud-label text-black/40 dark:text-white/40 mb-2">
                            [ACTIVACIÓN DE CUENTA]
                        </p>
                        <h2 className="text-2xl font-black uppercase tracking-tight leading-none mb-1">
                            {name ? decodeURIComponent(name) : 'NUEVO ACCESO'}
                        </h2>
                        <p className="text-[9px] font-mono text-black/20 dark:text-white/20 uppercase tracking-[0.3em]">
                            ID: {email || 'NO_DETECTED'}
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-8 relative z-10" autoComplete="off">
                        <div className="space-y-3">
                            <div className="flex justify-between items-end px-1">
                                <label className="hud-label text-black/60 dark:text-white/60">Verificación (RUT / RUN)</label>
                                <span className="text-[10px] font-mono text-black/20 dark:text-white/20">[01]</span>
                            </div>
                            <input
                                type="text"
                                value={taxId}
                                onChange={(e) => setTaxId(formatRut(e.target.value))}
                                className="premium-input text-center tracking-[0.2em] bg-black/5 dark:bg-black/80 font-mono"
                                placeholder="12.345.678-9"
                                required
                                autoFocus
                                spellCheck="false"
                                data-lpignore="true"
                            />
                        </div>

                        <div className="space-y-3">
                            <div className="flex justify-between items-end px-1">
                                <label className="hud-label text-black/60 dark:text-white/60">Contraseña Táctica</label>
                                <span className="text-[10px] font-mono text-black/20 dark:text-white/20">[02]</span>
                            </div>
                            <div className="relative group">
                                <input
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="premium-input pr-14 text-center tracking-[0.4em] bg-black/5 dark:bg-black/80"
                                    placeholder="••••••••"
                                    required
                                    autoComplete="new-password"
                                    spellCheck="false"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-5 top-1/2 -translate-y-1/2 text-black/40 dark:text-white/40 hover:text-black dark:hover:text-white transition-colors"
                                >
                                    <span className="material-symbols-rounded text-[20px]">
                                        {showPassword ? 'visibility_off' : 'visibility'}
                                    </span>
                                </button>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <div className="flex justify-between items-end px-1">
                                <label className="hud-label text-black/60 dark:text-white/60">Confirmar</label>
                                <span className="text-[10px] font-mono text-black/20 dark:text-white/20">[03]</span>
                            </div>
                            <input
                                type={showPassword ? "text" : "password"}
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="premium-input text-center tracking-[0.4em] bg-black/5 dark:bg-black/80"
                                placeholder="••••••••"
                                required
                                autoComplete="new-password"
                                spellCheck="false"
                            />
                        </div>

                        {error && (
                            <div className="p-4 rounded-2xl bg-rose-500/10 text-rose-500 dark:text-rose-400 text-[11px] font-bold text-center border border-rose-500/20 animate-in fade-in slide-in-from-top-2">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading || !!error || !accountId}
                            className="w-full py-6 bg-black dark:bg-white text-white dark:text-black font-black uppercase tracking-[0.3em] text-[12px] transition-all shadow-3xl active:scale-[0.98] disabled:opacity-30 flex items-center justify-center gap-4 mt-4"
                        >
                            {loading ? (
                                <Loader2 className="w-7 h-7 animate-spin text-white dark:text-black" />
                            ) : (
                                <>
                                    <span>CONFIRMAR EXCLUSIVIDAD</span>
                                    <ArrowRight size={24} />
                                </>
                            )}
                        </button>
                    </form>

                    <p className="mt-8 pt-6 border-t border-black/5 dark:border-white/5 text-[9px] text-center text-black/30 dark:text-white/30 font-mono tracking-widest leading-relaxed relative z-10">
                        ESTA CLAVE ES AISLADA E INDEPENDIENTE. SOLO TIENE VALIDEZ PARA LA OPERACIÓN EN ESTE ENTORNO ESPECÍFICO.
                    </p>
                </div>

                <footer className="mt-8 text-center space-y-4 opacity-40 hover:opacity-100 transition-opacity duration-500">
                    <div className="flex justify-center">
                        <ShieldCheck size={14} className="text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <p className="text-[10px] text-black/60 dark:text-white uppercase tracking-[0.3em] font-black">
                        © {new Date().getFullYear()} MINREPORT. SECURE INFRASTRUCTURE.
                    </p>
                </footer>
            </div>
        </div>
    );
};
