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
            <div className="mb-10">
                <div className="flex items-center gap-4 mb-2">
                    <div className="w-12 h-12 rounded-none bg-black/5 dark:bg-white/5 flex items-center justify-center border border-black/10 dark:border-white/10">
                        <UserPlus className="w-6 h-6 text-black/60 dark:text-white/60" />
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
                <Card className="!p-4 mb-8 !bg-emerald-500/5 dark:!bg-emerald-500/10 !border-emerald-500/20 !rounded-none">
                    <div className="flex items-center gap-3">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                        <div>
                            <p className="hud-label text-emerald-600 dark:text-emerald-400 mb-1">
                                [SUCCESS_OPERATION]
                            </p>
                            <p className="text-sm text-emerald-900 dark:text-emerald-50 pr-4">
                                Trabajador vinculado exitosamente. Se ha enviado un email con instrucciones.
                            </p>
                        </div>
                    </div>
                </Card>
            )}

            {/* Error Message */}
            {error && (
                <Card className="!p-4 mb-8 !bg-red-500/5 dark:!bg-red-500/10 !border-red-500/20 !rounded-none">
                    <div className="flex items-center gap-3">
                        <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0" />
                        <div>
                            <p className="hud-label text-red-600 dark:text-red-400 mb-1">
                                [ERROR_DETECTED]
                            </p>
                            <p className="text-sm text-red-900 dark:text-red-50">
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
                            <label className="hud-label text-black/40 dark:text-white/40 mb-3">
                                [01] RUN del Trabajador
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
                            <label className="hud-label text-black/40 dark:text-white/40 mb-3">
                                [02] Nombre Completo
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
                            <label className="hud-label text-black/40 dark:text-white/40 mb-3">
                                [03] Email Corporativo
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
                                    bg-black/5 dark:bg-white/5 
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
                            <label className="hud-label text-black/40 dark:text-white/40 mb-4">
                                [04] Perfil de Cargo / Rol Operativo
                            </label>

                            {profiles.length === 0 ? (
                                <div className="p-8 text-center bg-black/5 dark:bg-white/5 rounded-none border border-black/10 dark:border-white/10 relative overflow-hidden">
                                    <div className="absolute inset-0 technical-grid opacity-5 pointer-events-none"></div>
                                    <AlertCircle className="w-10 h-10 mx-auto mb-4 text-black/20 dark:text-white/20" />
                                    <p className="hud-label text-[10px] text-black/40 dark:text-white/40">
                                        REQUIRED_PROFILES_MISSING
                                    </p>
                                    <p className="text-[10px] text-black/30 dark:text-white/30 mt-2 font-bold uppercase tracking-tight">
                                        CREATE_PROFILE_BEFORE_LINKING_WORKER
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

            {/* Info Card */}
            <Card className="!p-8 mt-10 !bg-black/5 dark:!bg-white/5 !border-black/5 dark:!border-white/5 !rounded-none">
                <div className="flex items-start gap-5">
                    <div className="w-12 h-12 rounded-none bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 flex items-center justify-center flex-shrink-0">
                        <span className="material-symbols-rounded text-black/40 dark:text-white/40">
                            info
                        </span>
                    </div>
                    <div>
                        <p className="hud-label text-black/60 dark:text-white/60 mb-3">
                            [OPERATIONAL_PROTOCOL]
                        </p>
                        <ul className="text-xs font-bold text-black/60 dark:text-white/50 space-y-2 uppercase tracking-tight">
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
