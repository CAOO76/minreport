import { useState, useEffect } from 'react';
import { AlertCircle, CheckCircle2 } from 'lucide-react';
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
            <div className="mb-10 border-b border-gray-200 dark:border-gray-800 pb-6">
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Alta de Trabajador</h1>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Registra un nuevo colaborador y asígnale un perfil de cargo.</p>
            </div>

            {/* Success Message */}
            {success && (
                <div className="flex items-center gap-3 p-4 mb-8 border border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-500/10">
                    <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                    <p className="text-sm text-emerald-800 dark:text-emerald-300">
                        Trabajador vinculado exitosamente. Se ha enviado un email con instrucciones de acceso.
                    </p>
                </div>
            )}

            {/* Error Message */}
            {error && (
                <div className="flex items-center gap-3 p-4 mb-8 border border-red-500/30 bg-red-500/5 dark:bg-red-500/10">
                    <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                    <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
                </div>
            )}

            {/* Form */}
            <form onSubmit={handleSubmit}>
                <Card className="!p-8">
                    <div className="space-y-6">
                        {/* RUN */}
                        <div>
                            <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3 block">
                                RUN del Trabajador
                            </label>
                            <input
                                type="text"
                                value={run}
                                onChange={handleRunChange}
                                placeholder="12.345.678-9"
                                autoComplete="off"
                                spellCheck="false"
                                data-lpignore="true"
                                data-testid="worker-run-input"
                                className={`
                                    w-full px-5 py-4 rounded-none 
                                    bg-black/5 dark:bg-white/5 
                                    border ${runError ? 'border-red-500' : 'border-black/10 dark:border-white/10'}
                                    text-gray-900 dark:text-white 
                                    placeholder-black/20 dark:placeholder-white/10 
                                    focus:outline-none focus:border-black dark:focus:border-white 
                                    transition-all
                                    text-xl font-bold tracking-widest
                                `}
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
                            <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3 block">
                                Nombre Completo
                            </label>
                            <input
                                type="text"
                                value={fullName}
                                onChange={(e) => setFullName(e.target.value)}
                                placeholder="Juan Pérez González"
                                autoComplete="off"
                                spellCheck="false"
                                data-lpignore="true"
                                className="w-full px-5 py-4 rounded-none bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-gray-900 dark:text-white placeholder-black/20 dark:placeholder-white/10 focus:outline-none focus:border-black dark:focus:border-white transition-all font-bold"
                            />
                        </div>

                        {/* Email */}
                        <div>
                            <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-3 block">
                                Email Corporativo
                            </label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="juan.perez@empresa.com"
                                autoComplete="off"
                                spellCheck="false"
                                data-lpignore="true"
                                className={`
                                    w-full px-5 py-4 rounded-none
                                bg-black /5 dark:bg-white/5
                            border ${emailError ? 'border-red-500' : 'border-black/10 dark:border-white/10'}
                            text-gray-900 dark:text-white
                            placeholder-black/20 dark:placeholder-white/10
                            focus:outline-none focus:border-black dark:focus:border-white
                            transition-all font-bold
                                `}
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
                            <label className="text-xs font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400 mb-4 block">
                                Perfil de Cargo
                            </label>

                            {profiles.length === 0 ? (
                                <div className="p-6 text-center border border-gray-200 dark:border-gray-800">
                                    <p className="text-sm text-gray-500 dark:text-gray-400">No hay perfiles de cargo disponibles.</p>
                                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">Crea al menos un perfil antes de registrar personal.</p>
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
                                                    p-5 rounded-none border transition-all text-left relative overflow-hidden
                                                    ${isSelected
                                                        ? 'bg-black dark:bg-white text-white dark:text-black border-transparent'
                                                        : 'bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 hover:border-black/30 dark:hover:border-white/20'
                                                    }
                                                `}
                                                data-testid={`profile-card-${profile.name.replace(/\s+/g, '-').toLowerCase()}`}
                                            >
                                                <div className="flex items-start gap-4 z-10 relative">
                                                    <div className={`
                                                        w-10 h-10 rounded-none flex items-center justify-center flex-shrink-0
                                                        ${isSelected
                                                            ? 'bg-white/20 dark:bg-black/20'
                                                            : 'bg-black/5 dark:bg-white/5 border border-black/5 dark:border-white/5'
                                                        }
                                                    `}>
                                                        <span className={`
                                                            material-symbols-rounded text-xl
                                                            ${isSelected
                                                                ? 'text-white dark:text-black'
                                                                : 'text-black/40 dark:text-white/40'
                                                            }
                                                        `}>
                                                            badge
                                                        </span>
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <h4 className={`font-black text-[11px] uppercase tracking-widest truncate ${isSelected ? 'text-white dark:text-black' : 'text-black dark:text-white'}`}>
                                                            {profile.name}
                                                        </h4>
                                                        <p className={`text-[10px] mt-1 line-clamp-2 ${isSelected ? 'text-white/60 dark:text-black/60' : 'text-black/40 dark:text-white/40'}`}>
                                                            {profile.description || 'Sin descripción técnica del rol'}
                                                        </p>
                                                    </div>
                                                </div>
                                                {isSelected && (
                                                    <div className="absolute top-0 right-0 p-2">
                                                        <CheckCircle2 size={14} className="text-white dark:text-black opacity-40" />
                                                    </div>
                                                )}
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

            {/* Info */}
            <div className="mt-8 border-t border-gray-200 dark:border-gray-800 pt-6">
                <ul className="text-xs text-gray-500 dark:text-gray-400 space-y-1.5">
                    <li>• El colaborador recibirá un email con instrucciones de acceso.</li>
                    <li>• Heredará automáticamente los permisos del perfil asignado.</li>
                    <li>• Podrá configurar su contraseña desde el enlace del email.</li>
                </ul>
            </div>
        </div>
    );
};

export default StaffOnboarding;
