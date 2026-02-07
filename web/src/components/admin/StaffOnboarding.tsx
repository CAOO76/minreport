import { useState, useEffect } from 'react';
import { UserPlus, Briefcase, Mail, User, AlertCircle, CheckCircle2 } from 'lucide-react';
import { StaffService, type WorkerData } from '../../services/StaffService';
import { ProfileService } from '../../services/ProfileService';
import { useAuth } from '../../context/AuthContext';
import type { JobProfile } from '../../types/job_profile';
import { Button } from '../Button';
import { Card } from '../Card';
import { formatRut, validateRut } from '../../utils/rut';

/**
 * StaffOnboarding
 * 
 * Formulario de alta de trabajadores para empresas B2B.
 * Conecta la arquitectura de identidad global con los perfiles de cargo.
 * 
 * Diseño: Fintech Style con Material Design 3
 * Tipografía: Atkinson Hyperlegible
 */

export const StaffOnboarding = () => {
    const { currentAccount, user } = useAuth();
    const [profiles, setProfiles] = useState<JobProfile[]>([]);
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Form state
    const [run, setRun] = useState('');
    const [fullName, setFullName] = useState('');
    const [email, setEmail] = useState('');
    const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

    // Validation state
    const [runError, setRunError] = useState<string | null>(null);
    const [emailError, setEmailError] = useState<string | null>(null);

    // Cargar perfiles de cargo
    useEffect(() => {
        if (!currentAccount?.id) return;

        const unsubscribe = ProfileService.getProfiles(currentAccount.id, (loadedProfiles) => {
            setProfiles(loadedProfiles);
        });

        return () => unsubscribe();
    }, [currentAccount?.id]);

    // Validar RUN en tiempo real
    useEffect(() => {
        if (run && run.length >= 9) {
            const isValid = validateRut(run);
            setRunError(isValid ? null : 'RUN inválido');
        } else {
            setRunError(null);
        }
    }, [run]);

    // Validar email en tiempo real
    useEffect(() => {
        if (email) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            setEmailError(emailRegex.test(email) ? null : 'Email inválido');
        } else {
            setEmailError(null);
        }
    }, [email]);

    const handleRunChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setRun(formatRut(value));
    };

    const isFormValid =
        run.trim() !== '' &&
        fullName.trim() !== '' &&
        email.trim() !== '' &&
        selectedProfileId !== null &&
        !runError &&
        !emailError;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!isFormValid || !currentAccount?.id || !user?.uid) return;

        setLoading(true);
        setError(null);
        setSuccess(false);

        const workerData: WorkerData = {
            run: run,
            fullName: fullName.trim(),
            email: email.trim(),
            jobProfileId: selectedProfileId!
        };

        try {
            const result = await StaffService.recruitWorker(
                currentAccount.id,
                workerData,
                currentAccount.name || 'Empresa',
                user.uid
            );

            if (result.success) {
                setSuccess(true);
                // Limpiar formulario
                setRun('');
                setFullName('');
                setEmail('');
                setSelectedProfileId(null);

                // Ocultar mensaje de éxito después de 5 segundos
                setTimeout(() => setSuccess(false), 5000);
            } else {
                setError(result.error || 'Error al vincular trabajador');
            }
        } catch (err: any) {
            setError(err.message || 'Error desconocido');
        } finally {
            setLoading(false);
        }
    };

    if (!currentAccount) {
        return (
            <div className="flex items-center justify-center h-full">
                <p className="text-gray-500 dark:text-gray-400">
                    Selecciona una cuenta para gestionar trabajadores
                </p>
            </div>
        );
    }

    return (
        <div
            className="max-w-4xl mx-auto p-6"
            style={{ fontFamily: "'Atkinson Hyperlegible', sans-serif" }}
        >
            {/* Header */}
            <div className="mb-8">
                <div className="flex items-center gap-3 mb-2">
                    <div className="w-12 h-12 rounded-xl bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center">
                        <UserPlus className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                            Alta de Trabajador
                        </h1>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                            Vincula un nuevo miembro al equipo
                        </p>
                    </div>
                </div>
            </div>

            {/* Success Message */}
            {success && (
                <Card className="!p-4 mb-6 !bg-green-50 dark:!bg-green-900/20 !border-green-500">
                    <div className="flex items-center gap-3">
                        <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-400 flex-shrink-0" />
                        <div>
                            <p className="font-semibold text-green-900 dark:text-green-100">
                                ¡Trabajador vinculado exitosamente!
                            </p>
                            <p className="text-sm text-green-700 dark:text-green-300 mt-1">
                                Se ha enviado un email con las instrucciones de acceso.
                            </p>
                        </div>
                    </div>
                </Card>
            )}

            {/* Error Message */}
            {error && (
                <Card className="!p-4 mb-6 !bg-red-50 dark:!bg-red-900/20 !border-red-500">
                    <div className="flex items-center gap-3">
                        <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                        <div>
                            <p className="font-semibold text-red-900 dark:text-red-100">
                                Error al vincular trabajador
                            </p>
                            <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                                {error}
                            </p>
                        </div>
                    </div>
                </Card>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit}>
                <Card className="!p-8">
                    <div className="space-y-6">
                        {/* RUN */}
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                <div className="flex items-center gap-2">
                                    <User className="w-4 h-4" />
                                    RUN del Trabajador
                                </div>
                            </label>
                            <input
                                type="text"
                                value={run}
                                onChange={handleRunChange}
                                placeholder="12.345.678-9"
                                data-testid="worker-run-input"
                                className={`
                                    w-full px-4 py-3 rounded-lg 
                                    bg-gray-50 dark:bg-gray-900 
                                    border ${runError ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'}
                                    text-gray-900 dark:text-white 
                                    placeholder-gray-400 
                                    focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 
                                    transition-all
                                    text-lg font-mono
                                `}
                                autoComplete="off"
                            />
                            {runError && (
                                <p className="text-sm text-red-600 dark:text-red-400 mt-1 flex items-center gap-1">
                                    <AlertCircle className="w-3 h-3" />
                                    {runError}
                                </p>
                            )}
                        </div>

                        {/* Nombre Completo */}
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                Nombre Completo
                            </label>
                            <input
                                type="text"
                                value={fullName}
                                onChange={(e) => setFullName(e.target.value)}
                                placeholder="Juan Pérez González"
                                data-testid="worker-name-input"
                                className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 transition-all"
                                autoComplete="off"
                            />
                        </div>

                        {/* Email */}
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                <div className="flex items-center gap-2">
                                    <Mail className="w-4 h-4" />
                                    Email Corporativo
                                </div>
                            </label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="juan.perez@empresa.com"
                                data-testid="worker-email-input"
                                className={`
                                    w-full px-4 py-3 rounded-lg 
                                    bg-gray-50 dark:bg-gray-900 
                                    border ${emailError ? 'border-red-500' : 'border-gray-200 dark:border-gray-700'}
                                    text-gray-900 dark:text-white 
                                    placeholder-gray-400 
                                    focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 
                                    transition-all
                                `}
                                autoComplete="off"
                            />
                            {emailError && (
                                <p className="text-sm text-red-600 dark:text-red-400 mt-1 flex items-center gap-1">
                                    <AlertCircle className="w-3 h-3" />
                                    {emailError}
                                </p>
                            )}
                        </div>

                        {/* Selector de Perfil de Cargo */}
                        <div>
                            <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                                <div className="flex items-center gap-2">
                                    <Briefcase className="w-4 h-4" />
                                    Perfil de Cargo
                                </div>
                            </label>

                            {profiles.length === 0 ? (
                                <div className="p-8 text-center bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
                                    <AlertCircle className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                                    <p className="text-sm text-gray-500 dark:text-gray-400">
                                        No hay perfiles de cargo creados
                                    </p>
                                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                                        Crea un perfil antes de vincular trabajadores
                                    </p>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {profiles.map(profile => {
                                        const isSelected = selectedProfileId === profile.id;

                                        return (
                                            <button
                                                key={profile.id}
                                                type="button"
                                                onClick={() => setSelectedProfileId(profile.id)}
                                                className={`
                                                    p-4 rounded-lg border transition-all text-left
                                                    ${isSelected
                                                        ? 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-500 ring-2 ring-indigo-500/20'
                                                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-700'
                                                    }
                                                `}
                                                data-testid={`profile-card-${profile.name.replace(/\s+/g, '-').toLowerCase()}`}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <div className={`
                                                        w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0
                                                        ${isSelected
                                                            ? 'bg-indigo-100 dark:bg-indigo-500/20'
                                                            : 'bg-gray-100 dark:bg-gray-700'
                                                        }
                                                    `}>
                                                        <span className={`
                                                            material-symbols-rounded text-xl
                                                            ${isSelected
                                                                ? 'text-indigo-600 dark:text-indigo-400'
                                                                : 'text-gray-500 dark:text-gray-400'
                                                            }
                                                        `}>
                                                            badge
                                                        </span>
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <h4 className="font-semibold text-sm text-gray-900 dark:text-white truncate">
                                                            {profile.name}
                                                        </h4>
                                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5 line-clamp-2">
                                                            {profile.description || 'Sin descripción'}
                                                        </p>
                                                        <div className="flex items-center gap-1 mt-2">
                                                            <span className="material-symbols-rounded text-xs text-gray-400">
                                                                extension
                                                            </span>
                                                            <span className="text-xs text-gray-500 dark:text-gray-400">
                                                                {profile.allowedPlugins?.length || 0} plugins
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

                        {/* Submit Button */}
                        <div className="pt-4">
                            <Button
                                type="submit"
                                variant="primary"
                                icon="person_add"
                                disabled={!isFormValid || loading}
                                className="w-full !py-3 !text-base"
                            >
                                {loading ? 'Vinculando...' : 'Vincular Trabajador'}
                            </Button>
                        </div>
                    </div>
                </Card>
            </form>

            {/* Info Card */}
            <Card className="!p-6 mt-6 !bg-blue-50 dark:!bg-blue-900/20 !border-blue-200 dark:!border-blue-800">
                <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                        <span className="material-symbols-rounded text-blue-600 dark:text-blue-400">
                            info
                        </span>
                    </div>
                    <div>
                        <h3 className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
                            ¿Cómo funciona?
                        </h3>
                        <ul className="text-sm text-blue-800 dark:text-blue-200 space-y-1">
                            <li>• El trabajador recibirá un email con instrucciones de acceso</li>
                            <li>• Heredará automáticamente los permisos del perfil asignado</li>
                            <li>• Podrá configurar su contraseña desde el enlace del email</li>
                        </ul>
                    </div>
                </div>
            </Card>
        </div>
    );
};

export default StaffOnboarding;
