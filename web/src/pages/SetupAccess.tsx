import { useState, useEffect } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Loader2, Lock, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import BrandLogo from '../components/BrandLogo';

export const SetupAccess = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    // Context from URL
    const accountId = searchParams.get('accountId');
    const taxId = searchParams.get('taxId');
    const email = searchParams.get('email');

    // States
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        if (!accountId || !taxId) {
            setError('Enlace de activación inválido o expirado.');
        }
    }, [accountId, taxId]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (password !== confirmPassword) {
            setError('Las contraseñas no coinciden.');
            return;
        }

        setLoading(true);
        setError('');

        try {
            const response = await fetch(`${import.meta.env.VITE_API_URL}/api/auth/tunnel/setup-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    taxId,
                    accountId,
                    password
                })
            });

            const data = await response.json();

            if (!response.ok) {
                setError(data.error || 'Error al establecer la contraseña.');
                return;
            }

            setSuccess(true);
            // Redirigir al login después de 3 segundos
            setTimeout(() => {
                navigate('/login');
            }, 3000);

        } catch (err) {
            setError('Error de conexión con el servidor.');
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#121212] p-4">
                <div className="w-full max-w-md bg-white dark:bg-[#1E1E1E] rounded-3xl p-8 shadow-sm border border-gray-100 dark:border-gray-800 text-center animate-in zoom-in duration-500">
                    <div className="w-20 h-20 bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 rounded-full flex items-center justify-center mx-auto mb-6">
                        <CheckCircle2 size={48} />
                    </div>
                    <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">¡Seguridad Activada!</h1>
                    <p className="text-gray-500 dark:text-gray-400">
                        Tu contraseña exclusiva ha sido guardada. Serás redirigido al inicio de sesión en unos instantes.
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#121212] p-4 text-Atkinson">
            <div className="w-full max-w-md">
                {/* Logo */}
                <div className="mb-8 flex justify-center">
                    <BrandLogo variant="imagotype" className="h-10" />
                </div>

                <div className="bg-white dark:bg-[#1E1E1E] rounded-3xl p-8 shadow-sm border border-gray-100 dark:border-gray-800">
                    <div className="text-center mb-8">
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white uppercase tracking-tight">Activar Acceso Seguro</h1>
                        <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm">
                            Establece la clave exclusiva para tu perfil en esta cuenta.
                        </p>
                    </div>

                    {/* Security Badge Context */}
                    <div className="mb-8 p-4 bg-indigo-50 dark:bg-indigo-500/5 rounded-2xl border border-indigo-100 dark:border-indigo-500/20">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-white dark:bg-white/5 flex items-center justify-center shadow-sm">
                                <Lock className="text-indigo-600 dark:text-indigo-400" size={20} />
                            </div>
                            <div>
                                <p className="text-[10px] font-bold text-indigo-400 dark:text-indigo-500 uppercase tracking-widest">Entorno de Identidad</p>
                                <p className="text-sm font-bold text-gray-700 dark:text-gray-200 truncate max-w-[240px]">{email || taxId}</p>
                            </div>
                        </div>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6" autoComplete="off">
                        <div className="space-y-1">
                            <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest ml-1">
                                Nueva Contraseña
                            </label>
                            <div className="relative">
                                <input
                                    type={showPassword ? "text" : "password"}
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    className="w-full pl-5 pr-12 py-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                                    placeholder="Mínimo 8 caracteres"
                                    required
                                    autoFocus
                                    autoComplete="off"
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                                >
                                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                </button>
                            </div>
                        </div>

                        <div className="space-y-1">
                            <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest ml-1">
                                Confirmar Contraseña
                            </label>
                            <input
                                type={showPassword ? "text" : "password"}
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="w-full px-5 py-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                                placeholder="Repite la contraseña"
                                required
                                autoComplete="off"
                            />
                        </div>

                        {error && (
                            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 text-xs font-medium text-center">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading || !!error}
                            className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-md active:scale-[0.98] disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : 'Activar Clave Exclusiva'}
                        </button>
                    </form>

                    <p className="mt-8 text-[11px] text-center text-gray-400 leading-relaxed">
                        Esta clave es única para este acceso corporativo/institucional. <br />
                        Sus datos están protegidos bajo estándares de seguridad bancaria.
                    </p>
                </div>
            </div>
        </div>
    );
};
