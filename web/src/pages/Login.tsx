import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Loader2, Lock, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import BrandLogo from '../components/BrandLogo';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { Link } from 'react-router-dom';
import { useAuthActions } from '../hooks/useAuthActions';

/**
 * Login con Smart Gateway (RUT/Email)
 * Implementa detección automática de tipo de identificador y formateo en tiempo real.
 */
export const Login = () => {
    const navigate = useNavigate();
    const { signIn, recoverAccess, loading, error, clearError } = useAuthActions();

    // Estados del Formulario
    const [identifier, setIdentifier] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    // Estados de Recuperación
    const [showRecoveryModal, setShowRecoveryModal] = useState(false);
    const [recoveryRut, setRecoveryRut] = useState('');
    const [recoverySuccess, setRecoverySuccess] = useState(false);
    const [recoveryData, setRecoveryData] = useState<{
        email: string;
        phone: string;
    } | null>(null);

    // Detección de tipo de input (RUT vs Email)
    const [inputType, setInputType] = useState<'RUT' | 'EMAIL'>('EMAIL');

    // Limpieza de Memoria (Zero Memory Policy)
    useEffect(() => {
        return () => {
            setIdentifier('');
            setPassword('');
            setRecoveryRut('');
        };
    }, []);

    /**
     * Formatea RUT chileno en tiempo real: 12.345.678-9
     */
    const formatRut = (value: string): string => {
        // Limpiar todo excepto números y K
        const clean = value.replace(/[^0-9kK]/g, '');
        if (clean.length === 0) return '';

        // Separar cuerpo y dígito verificador
        const body = clean.slice(0, -1);
        const dv = clean.slice(-1);

        // Formatear con puntos
        let formatted = '';
        for (let i = body.length - 1, j = 0; i >= 0; i--, j++) {
            if (j > 0 && j % 3 === 0) formatted = '.' + formatted;
            formatted = body[i] + formatted;
        }

        // Agregar guión y DV si existe
        if (dv) formatted += '-' + dv.toUpperCase();

        return formatted;
    };

    /**
     * Maneja el cambio del input con detección automática y formateo
     */
    const handleIdentifierChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;

        // Detectar tipo de input
        if (value.includes('@')) {
            // Es Email
            setInputType('EMAIL');
            setIdentifier(value);
        } else if (/^[0-9kK.\-\s]*$/.test(value)) {
            // Parece RUT (solo números, K, puntos, guiones)
            setInputType('RUT');
            const formatted = formatRut(value);
            setIdentifier(formatted);
        } else {
            // Contiene letras pero no @, asumir Email
            setInputType('EMAIL');
            setIdentifier(value);
        }

        clearError();
    };

    /**
     * Maneja el submit del login
     */
    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!identifier.trim() || !password) return;

        try {
            await signIn(identifier, password);
            // Limpieza y redirección
            setPassword('');
            navigate('/');
        } catch (err) {
            // El error ya está manejado por el hook
            console.error('Login failed:', err);
        }
    };

    /**
     * Maneja la recuperación de contraseña
     */
    const handleRecovery = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!recoveryRut.trim()) return;

        try {
            const result = await recoverAccess(recoveryRut);
            setRecoveryData({
                email: result.email,
                phone: result.phone
            });
            setRecoverySuccess(true);
        } catch (err) {
            // El error ya está manejado por el hook
            console.error('Recovery failed:', err);
        }
    };

    /**
     * Cierra el modal de recuperación y resetea estados
     */
    const closeRecoveryModal = () => {
        setShowRecoveryModal(false);
        setRecoverySuccess(false);
        setRecoveryRut('');
        setRecoveryData(null);
        clearError();
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#121212] transition-colors p-4 relative overflow-hidden">
            {/* Controles de Idioma y Tema */}
            <div className="absolute top-6 right-6 flex items-center gap-3 z-50">
                <LanguageSwitch />
                <ThemeSwitch />
            </div>

            <div className="w-full max-w-md relative">
                {/* Logo Centrado */}
                <div className="mb-8 flex justify-center">
                    <div className="w-16 h-16 bg-white dark:bg-white/5 rounded-2xl flex items-center justify-center shadow-lg shadow-gray-200/50 dark:shadow-none border border-gray-100 dark:border-gray-800">
                        <BrandLogo variant="isotype" className="w-8 h-8" />
                    </div>
                </div>

                {/* Formulario de Login */}
                {!showRecoveryModal && (
                    <div className="bg-white dark:bg-[#1E1E1E] rounded-3xl p-8 shadow-sm border border-gray-100 dark:border-gray-800 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div className="text-center mb-8">
                            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                                Hola de nuevo
                            </h1>
                            <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm">
                                Ingresa tus credenciales para continuar
                            </p>
                        </div>

                        <form onSubmit={handleLogin} className="space-y-6" autoComplete="off">
                            {/* Smart Input: RUT o Email */}
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest ml-1">
                                    RUT o Correo Electrónico
                                </label>
                                <div className="relative">
                                    <input
                                        type="text"
                                        name="user_identifier_field_v2"
                                        value={identifier}
                                        onChange={handleIdentifierChange}
                                        className="w-full px-5 py-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium text-lg"
                                        placeholder={inputType === 'RUT' ? '12.345.678-9' : 'nombre@empresa.com'}
                                        required
                                        autoFocus
                                        autoComplete="off"
                                        data-lpignore="true"
                                    />
                                    {/* Indicador de tipo detectado */}
                                    {identifier && (
                                        <div className="absolute right-4 top-1/2 -translate-y-1/2">
                                            <span className="text-xs font-bold text-gray-400 dark:text-gray-500 uppercase">
                                                {inputType}
                                            </span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Input de Contraseña */}
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest ml-1">
                                    Contraseña
                                </label>
                                <div className="relative group">
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        name="pwd_challenge_field"
                                        value={password}
                                        onChange={(e) => {
                                            setPassword(e.target.value);
                                            clearError();
                                        }}
                                        className="w-full pl-5 pr-12 py-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium text-lg"
                                        placeholder="••••••••"
                                        required
                                        autoComplete="new-password"
                                        data-lpignore="true"
                                        data-form-type="other"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                                    >
                                        {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                    </button>
                                </div>
                            </div>

                            {/* Link de Recuperación */}
                            <div className="text-right">
                                <button
                                    type="button"
                                    onClick={() => setShowRecoveryModal(true)}
                                    className="text-sm text-indigo-600 dark:text-indigo-400 hover:underline font-medium"
                                >
                                    ¿Olvidó su clave?
                                </button>
                            </div>

                            {/* Mensaje de Error */}
                            {error && (
                                <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 text-xs font-medium text-center animate-in fade-in">
                                    {error}
                                </div>
                            )}

                            {/* Botón de Login */}
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-md shadow-indigo-600/20 active:scale-[0.98] disabled:opacity-70 flex items-center justify-center gap-2"
                            >
                                {loading ? (
                                    <Loader2 className="w-6 h-6 animate-spin" />
                                ) : (
                                    <>
                                        <span>Ingresar</span>
                                        <Lock size={18} />
                                    </>
                                )}
                            </button>
                        </form>

                        {/* Link de Registro */}
                        <div className="mt-8 pt-6 border-t border-gray-100 dark:border-gray-800 text-center">
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                ¿No tienes una cuenta?{' '}
                                <Link to="/register-selection" className="text-indigo-600 dark:text-indigo-400 font-bold hover:underline">
                                    Crear cuenta
                                </Link>
                            </p>
                        </div>
                    </div>
                )}

                {/* Modal de Recuperación de Contraseña */}
                {showRecoveryModal && (
                    <div className="bg-white dark:bg-[#1E1E1E] rounded-3xl p-8 shadow-sm border border-gray-100 dark:border-gray-800 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {!recoverySuccess ? (
                            <>
                                <div className="text-center mb-8">
                                    <div className="w-16 h-16 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                        <Lock size={32} />
                                    </div>
                                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                                        Recuperar Acceso
                                    </h2>
                                    <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm">
                                        Ingresa tu RUT para recibir instrucciones
                                    </p>
                                </div>

                                <form onSubmit={handleRecovery} className="space-y-6" autoComplete="off">
                                    <div className="space-y-1">
                                        <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest ml-1">
                                            RUT
                                        </label>
                                        <input
                                            type="text"
                                            value={recoveryRut}
                                            onChange={(e) => {
                                                const formatted = formatRut(e.target.value);
                                                setRecoveryRut(formatted);
                                                clearError();
                                            }}
                                            className="w-full px-5 py-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium text-lg"
                                            placeholder="12.345.678-9"
                                            required
                                            autoFocus
                                            autoComplete="off"
                                            data-lpignore="true"
                                        />
                                    </div>

                                    {error && (
                                        <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 text-xs font-medium text-center animate-in fade-in">
                                            {error}
                                        </div>
                                    )}

                                    <div className="space-y-3">
                                        <button
                                            type="submit"
                                            disabled={loading}
                                            className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-md shadow-indigo-600/20 active:scale-[0.98] disabled:opacity-70 flex items-center justify-center gap-2"
                                        >
                                            {loading ? (
                                                <Loader2 className="w-6 h-6 animate-spin" />
                                            ) : (
                                                <span>Enviar Instrucciones</span>
                                            )}
                                        </button>

                                        <button
                                            type="button"
                                            onClick={closeRecoveryModal}
                                            className="w-full py-3 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                                        >
                                            <ArrowLeft size={18} />
                                            <span>Volver al inicio</span>
                                        </button>
                                    </div>
                                </form>
                            </>
                        ) : (
                            <>
                                <div className="text-center mb-8">
                                    <div className="w-16 h-16 bg-green-50 dark:bg-green-500/10 text-green-600 dark:text-green-400 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                        <span className="material-symbols-rounded text-4xl">check_circle</span>
                                    </div>
                                    <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                                        Instrucciones Enviadas
                                    </h2>
                                    <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm">
                                        Revisa tu correo y teléfono registrados
                                    </p>
                                </div>

                                <div className="space-y-4 mb-8">
                                    <div className="p-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700">
                                        <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-2">
                                            Correo Electrónico
                                        </p>
                                        <p className="text-lg font-medium text-gray-900 dark:text-white">
                                            {recoveryData?.email}
                                        </p>
                                    </div>

                                    {recoveryData?.phone && (
                                        <div className="p-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700">
                                            <p className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest mb-2">
                                                Móvil Asociado
                                            </p>
                                            <p className="text-lg font-medium text-gray-900 dark:text-white">
                                                {recoveryData?.phone}
                                            </p>
                                        </div>
                                    )}
                                </div>

                                <button
                                    onClick={closeRecoveryModal}
                                    className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-md shadow-indigo-600/20 active:scale-[0.98]"
                                >
                                    Volver al inicio
                                </button>
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
