import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { doc, setDoc, collection, query, where, getDocs, limit } from 'firebase/firestore';
import { auth, db } from '../config/firebase';
import { Loader2, Building2, User, Mail, Phone, Lock, Eye, EyeOff, ArrowLeft } from 'lucide-react';
import BrandLogo from '../components/BrandLogo';
import { LanguageSwitch } from '../components/LanguageSwitch';
import { ThemeSwitch } from '../components/ThemeSwitch';
import { formatRut, validateRut } from '../utils/rut';
import type { UserProfile, Account } from '../../../src/types/auth';

/**
 * Registro B2B con Login Corporativo (RUT Empresa)
 * El RUT de la empresa se convierte en el identificador de login del administrador.
 */
export const RequestAccount = () => {
    const navigate = useNavigate();

    // Estados del Formulario
    const [formData, setFormData] = useState({
        // Empresa (Credenciales)
        companyRut: '',
        companyName: '',
        industry: '',

        // Contacto (Administrador)
        adminName: '',
        adminEmail: '',
        adminPhone: '',
        password: '',
        confirmPassword: ''
    });

    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    /**
     * Maneja cambios en los inputs con formateo automático de RUT
     */
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;

        if (name === 'companyRut') {
            setFormData(prev => ({
                ...prev,
                [name]: formatRut(value)
            }));
        } else {
            setFormData(prev => ({
                ...prev,
                [name]: value
            }));
        }

        setError('');
    };

    /**
     * Limpia el RUT para almacenamiento (formato: 12345678-9)
     */
    const cleanRutForStorage = (rut: string): string => {
        const clean = rut.replace(/[^0-9kK]/g, '');
        if (clean.length < 2) return clean;
        const body = clean.slice(0, -1);
        const dv = clean.slice(-1).toUpperCase();
        return `${body}-${dv}`;
    };

    /**
     * Valida el formulario antes de enviar
     */
    const validateForm = (): boolean => {
        // Validar campos obligatorios
        if (!formData.companyRut || !formData.companyName || !formData.industry ||
            !formData.adminName || !formData.adminEmail || !formData.adminPhone ||
            !formData.password || !formData.confirmPassword) {
            setError('Todos los campos son obligatorios');
            return false;
        }

        // Validar RUT
        if (!validateRut(formData.companyRut)) {
            setError('RUT de empresa inválido');
            return false;
        }

        // Validar email
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(formData.adminEmail)) {
            setError('Email inválido');
            return false;
        }

        // Validar contraseña
        if (formData.password.length < 6) {
            setError('La contraseña debe tener al menos 6 caracteres');
            return false;
        }

        if (formData.password !== formData.confirmPassword) {
            setError('Las contraseñas no coinciden');
            return false;
        }

        return true;
    };

    /**
     * Maneja el submit del formulario
     */
    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();

        if (!validateForm()) return;

        setLoading(true);
        setError('');

        try {
            const cleanRut = cleanRutForStorage(formData.companyRut);

            // Paso 1: Verificar unicidad del RUT corporativo
            const accountsRef = collection(db, 'accounts');
            const rutQuery = query(accountsRef, where('rut', '==', cleanRut), limit(1));
            const rutSnapshot = await getDocs(rutQuery);

            if (!rutSnapshot.empty) {
                throw new Error('Este RUT ya está registrado');
            }

            // Paso 2: Crear usuario en Firebase Auth
            const userCredential = await createUserWithEmailAndPassword(
                auth,
                formData.adminEmail,
                formData.password
            );
            const user = userCredential.user;

            // Paso 3: Crear Account (Empresa)
            const accountId = `acc_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const accountData: Account = {
                id: accountId,
                name: formData.companyName,
                type: 'BUSINESS',
                rut: cleanRut, // RUT de la empresa (obligatorio)
                ownerId: user.uid,
                primaryOperator: {
                    name: formData.adminName,
                    email: formData.adminEmail,
                    uid: user.uid,
                    status: 'ACTIVE'
                },
                createdAt: Date.now(),
                updatedAt: Date.now()
            };

            await setDoc(doc(db, 'accounts', accountId), accountData);

            // Paso 4: Crear UserProfile
            const userProfileData: UserProfile = {
                uid: user.uid,
                // CAMPO CLAVE: El RUT de la empresa es el identificador de login
                rut: cleanRut,
                loginMethod: 'RUT',
                email: formData.adminEmail, // Credencial técnica de Firebase Auth
                contactEmail: formData.adminEmail, // Email de recuperación/comunicación
                recoveryPhone: formData.adminPhone,
                displayName: formData.adminName,
                memberships: [
                    {
                        accountId: accountId,
                        role: 'OWNER', // Administrador inicial
                        companyName: formData.companyName,
                        joinedAt: Date.now()
                    }
                ],
                lastActiveAccountId: accountId,
                createdAt: Date.now(),
                updatedAt: Date.now()
            };

            await setDoc(doc(db, 'users', user.uid), userProfileData);

            // Paso 5: Limpieza y redirección
            setFormData({
                companyRut: '',
                companyName: '',
                industry: '',
                adminName: '',
                adminEmail: '',
                adminPhone: '',
                password: '',
                confirmPassword: ''
            });

            // Redirigir al dashboard
            navigate('/');

        } catch (err: any) {
            console.error('Registration error:', err);

            let errorMessage = 'Error al crear la cuenta';

            if (err.code === 'auth/email-already-in-use') {
                errorMessage = 'Este email ya está registrado';
            } else if (err.code === 'auth/weak-password') {
                errorMessage = 'La contraseña es muy débil';
            } else if (err.code === 'auth/invalid-email') {
                errorMessage = 'Email inválido';
            } else if (err.message) {
                errorMessage = err.message;
            }

            setError(errorMessage);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-[#121212] transition-colors p-4 relative overflow-hidden">
            {/* Controles de Idioma y Tema */}
            <div className="absolute top-6 right-6 flex items-center gap-3 z-50">
                <LanguageSwitch />
                <ThemeSwitch />
            </div>

            <div className="w-full max-w-2xl relative">
                {/* Logo Centrado */}
                <div className="mb-8 flex justify-center">
                    <div className="w-16 h-16 bg-white dark:bg-white/5 rounded-2xl flex items-center justify-center shadow-lg shadow-gray-200/50 dark:shadow-none border border-gray-100 dark:border-gray-800">
                        <BrandLogo variant="isotype" className="w-8 h-8" />
                    </div>
                </div>

                {/* Formulario de Registro B2B */}
                <div className="bg-white dark:bg-[#1E1E1E] rounded-3xl p-8 shadow-sm border border-gray-100 dark:border-gray-800 animate-in fade-in slide-in-from-bottom-4 duration-500">
                    <div className="text-center mb-8">
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
                            Registro Empresarial
                        </h1>
                        <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm">
                            Crea tu cuenta corporativa en MINREPORT
                        </p>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6" autoComplete="off">
                        {/* Sección Empresa */}
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 pb-2 border-b border-gray-200 dark:border-gray-700">
                                <Building2 size={20} className="text-indigo-600 dark:text-indigo-400" />
                                <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                                    Datos de la Empresa
                                </h2>
                            </div>

                            {/* RUT Empresa */}
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest ml-1">
                                    RUT Empresa *
                                </label>
                                <input
                                    type="text"
                                    name="companyRut"
                                    value={formData.companyRut}
                                    onChange={handleChange}
                                    className="w-full px-5 py-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium text-lg"
                                    placeholder="12.345.678-9"
                                    required
                                    autoComplete="off"
                                    data-lpignore="true"
                                />
                                <p className="text-xs text-gray-500 dark:text-gray-400 ml-1">
                                    Este RUT será tu identificador de login
                                </p>
                            </div>

                            {/* Razón Social */}
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest ml-1">
                                    Razón Social *
                                </label>
                                <input
                                    type="text"
                                    name="companyName"
                                    value={formData.companyName}
                                    onChange={handleChange}
                                    className="w-full px-5 py-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
                                    placeholder="Empresa S.A."
                                    required
                                    autoComplete="off"
                                />
                            </div>

                            {/* Giro/Industria */}
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest ml-1">
                                    Giro / Industria *
                                </label>
                                <input
                                    type="text"
                                    name="industry"
                                    value={formData.industry}
                                    onChange={handleChange}
                                    className="w-full px-5 py-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
                                    placeholder="Construcción, Tecnología, etc."
                                    required
                                    autoComplete="off"
                                />
                            </div>
                        </div>

                        {/* Sección Administrador */}
                        <div className="space-y-4">
                            <div className="flex items-center gap-2 pb-2 border-b border-gray-200 dark:border-gray-700">
                                <User size={20} className="text-indigo-600 dark:text-indigo-400" />
                                <h2 className="text-sm font-bold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                                    Administrador de la Cuenta
                                </h2>
                            </div>

                            {/* Nombre Completo */}
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest ml-1">
                                    Nombre Completo *
                                </label>
                                <input
                                    type="text"
                                    name="adminName"
                                    value={formData.adminName}
                                    onChange={handleChange}
                                    className="w-full px-5 py-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
                                    placeholder="Juan Pérez"
                                    required
                                    autoComplete="off"
                                />
                            </div>

                            {/* Email Corporativo */}
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest ml-1 flex items-center gap-2">
                                    <Mail size={14} />
                                    Email Corporativo *
                                </label>
                                <input
                                    type="email"
                                    name="adminEmail"
                                    value={formData.adminEmail}
                                    onChange={handleChange}
                                    className="w-full px-5 py-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
                                    placeholder="admin@empresa.com"
                                    required
                                    autoComplete="off"
                                    data-lpignore="true"
                                />
                                <p className="text-xs text-gray-500 dark:text-gray-400 ml-1">
                                    Para notificaciones y recuperación de cuenta
                                </p>
                            </div>

                            {/* Teléfono Móvil */}
                            <div className="space-y-1">
                                <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest ml-1 flex items-center gap-2">
                                    <Phone size={14} />
                                    Teléfono Móvil *
                                </label>
                                <input
                                    type="tel"
                                    name="adminPhone"
                                    value={formData.adminPhone}
                                    onChange={handleChange}
                                    className="w-full px-5 py-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
                                    placeholder="+56 9 1234 5678"
                                    required
                                    autoComplete="off"
                                />
                            </div>

                            {/* Contraseña */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest ml-1">
                                        Contraseña *
                                    </label>
                                    <div className="relative">
                                        <input
                                            type={showPassword ? "text" : "password"}
                                            name="password"
                                            value={formData.password}
                                            onChange={handleChange}
                                            className="w-full pl-5 pr-12 py-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
                                            placeholder="••••••••"
                                            required
                                            autoComplete="new-password"
                                            data-lpignore="true"
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

                                <div className="space-y-1">
                                    <label className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-widest ml-1">
                                        Confirmar Contraseña *
                                    </label>
                                    <div className="relative">
                                        <input
                                            type={showConfirmPassword ? "text" : "password"}
                                            name="confirmPassword"
                                            value={formData.confirmPassword}
                                            onChange={handleChange}
                                            className="w-full pl-5 pr-12 py-4 rounded-xl bg-gray-50 dark:bg-white/5 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all font-medium"
                                            placeholder="••••••••"
                                            required
                                            autoComplete="new-password"
                                            data-lpignore="true"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                            className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors"
                                        >
                                            {showConfirmPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Mensaje de Error */}
                        {error && (
                            <div className="p-3 rounded-lg bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 text-xs font-medium text-center animate-in fade-in">
                                {error}
                            </div>
                        )}

                        {/* Botones de Acción */}
                        <div className="space-y-3 pt-4">
                            <button
                                type="submit"
                                disabled={loading}
                                className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl transition-all shadow-md shadow-indigo-600/20 active:scale-[0.98] disabled:opacity-70 flex items-center justify-center gap-2"
                            >
                                {loading ? (
                                    <Loader2 className="w-6 h-6 animate-spin" />
                                ) : (
                                    <>
                                        <span>Crear Cuenta Empresarial</span>
                                        <Lock size={18} />
                                    </>
                                )}
                            </button>

                            <Link
                                to="/login"
                                className="w-full py-3 text-gray-500 dark:text-gray-400 hover:bg-gray-50 dark:hover:bg-white/5 rounded-xl font-medium transition-colors flex items-center justify-center gap-2"
                            >
                                <ArrowLeft size={18} />
                                <span>Volver al inicio</span>
                            </Link>
                        </div>
                    </form>

                    {/* Nota Informativa */}
                    <div className="mt-6 p-4 rounded-xl bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800">
                        <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">
                            <strong>Importante:</strong> El RUT de tu empresa será tu identificador de login.
                            Podrás acceder usando <strong>RUT + Contraseña</strong> en lugar de email.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};
