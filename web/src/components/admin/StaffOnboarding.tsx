import React, { useState, useEffect } from 'react';
import { StaffService, type WorkerData } from '../../services/StaffService';
import { ProfileService } from '../../services/ProfileService';
import { useAuth } from '../../context/AuthContext';
import type { JobProfile } from '../../types/job_profile';
import { formatRut, validateRut } from '../../utils/rut';

const labelClass = 'block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] mb-fib-8';
const inputBaseClass = 'w-full px-fib-13 py-fib-13 rounded-none shadow-none bg-[#FFFFFF] dark:bg-[#000000] border text-data-dense text-[#0F172A] dark:text-[#F3F4F6] placeholder-[#94A3B8] dark:placeholder-[#5A6072] focus:outline-none focus:border-[#C68346] transition-colors';

export const StaffOnboarding: React.FC = () => {
    const { currentAccount, user } = useAuth();
    const [profiles, setProfiles] = useState<JobProfile[]>([]);
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [run, setRun] = useState('');
    const [fullName, setFullName] = useState('');
    const [email, setEmail] = useState('');
    const [selectedProfileId, setSelectedProfileId] = useState<string | null>(null);

    const [runError, setRunError] = useState<string | null>(null);
    const [emailError, setEmailError] = useState<string | null>(null);

    const [showConfirmModal, setShowConfirmModal] = useState(false);
    const [confirmKeyword, setConfirmKeyword] = useState('');

    useEffect(() => {
        if (!currentAccount?.id) return;
        const unsubscribe = ProfileService.getProfiles(currentAccount.id, (loadedProfiles) => {
            setProfiles(loadedProfiles);
        });
        return () => unsubscribe();
    }, [currentAccount?.id]);

    useEffect(() => {
        if (run && run.length >= 9) {
            const isValid = validateRut(run);
            setRunError(isValid ? null : 'RUN inválido');
        } else {
            setRunError(null);
        }
    }, [run]);

    useEffect(() => {
        if (email) {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            setEmailError(emailRegex.test(email) ? null : 'Email inválido');
        } else {
            setEmailError(null);
        }
    }, [email]);

    const handleRunChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setRun(formatRut(e.target.value));
    };

    const isFormValid =
        run.trim() !== '' &&
        fullName.trim() !== '' &&
        email.trim() !== '' &&
        selectedProfileId !== null &&
        !runError &&
        !emailError;

    const handlePreSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!isFormValid || !currentAccount?.id || !user?.uid) return;
        setConfirmKeyword('');
        setShowConfirmModal(true);
    };

    const handleConfirmedRecruit = async () => {
        if (confirmKeyword !== 'ACTUALIZAR') return;
        if (!isFormValid || !currentAccount?.id || !user?.uid) return;

        setLoading(true);
        setShowConfirmModal(false);
        setError(null);
        setSuccess(false);

        const workerData: WorkerData = {
            run: run,
            fullName: fullName.trim(),
            email: email.trim(),
            jobProfileId: selectedProfileId!,
        };

        try {
            const result = await StaffService.recruitWorker(
                currentAccount.id,
                workerData,
                currentAccount.name || 'Empresa'
            );

            if (result.success) {
                setSuccess(true);
                setRun('');
                setFullName('');
                setEmail('');
                setSelectedProfileId(null);
                setConfirmKeyword('');
                setTimeout(() => setSuccess(false), 5000);
            } else {
                setError(result.error || 'Error al vincular trabajador');
            }
        } catch (err: any) {
            setError(err.message || 'Error en la vinculación de personal');
        } finally {
            setLoading(false);
        }
    };

    if (!currentAccount) {
        return (
            <div className="flex items-center justify-center p-fib-34 font-mono text-data-dense text-[#94A3B8] dark:text-[#5A6072]">
                Seleccione una cuenta activa para registrar colaboradores.
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto py-fib-34 px-fib-21 space-y-fib-34 font-sans select-none bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6]">
            {/* Encabezado Técnico */}
            <header className="border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-21">
                <span className="text-microcopy font-mono uppercase text-[#C68346] block mb-fib-8">
                    MINREPORT // DOTACIÓN OPERACIONAL
                </span>
                <h1 className="text-h1-header font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                    Alta de Colaborador
                </h1>
                <p className="text-data-dense text-[#475569] dark:text-[#8A93A6] mt-fib-8">
                    Vinculación nominal por RUN con asignación obligatoria de perfil de cargo.
                </p>
            </header>

            {success && (
                <div className="flex items-center gap-fib-13 p-fib-13 border border-[#00AEEF]/40 bg-[#00AEEF]/5 rounded-none">
                    <span className="material-symbols-outlined text-[20px] text-[#00AEEF] shrink-0">check_circle</span>
                    <p className="text-data-dense text-[#0F172A] dark:text-[#F3F4F6]">
                        Colaborador vinculado correctamente. Se despacharon las instrucciones de activación al correo registrado.
                    </p>
                </div>
            )}

            {error && (
                <div className="flex items-center gap-fib-13 p-fib-13 border border-red-500/30 bg-red-500/5 rounded-none">
                    <span className="material-symbols-outlined text-[20px] text-red-500 shrink-0">error</span>
                    <p className="text-data-dense font-mono text-red-600 dark:text-red-400">{error}</p>
                </div>
            )}

            {/* Macro-Layout Proporción Áurea: 61.8% Formulario / 38.2% Criterios Operativos */}
            <div className="grid grid-cols-1 lg:grid-cols-[61.8fr_38.2fr] gap-fib-21 items-start">
                <form
                    onSubmit={handlePreSubmit}
                    autoComplete="off"
                    spellCheck={false}
                    className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-21 sm:p-fib-34 rounded-none shadow-none space-y-fib-21"
                >
                    <div>
                        <label className={labelClass}>RUN del Colaborador *</label>
                        <input
                            type="text"
                            value={run}
                            onChange={handleRunChange}
                            placeholder="12.345.678-9"
                            autoComplete="off"
                            spellCheck={false}
                            data-testid="worker-run-input"
                            className={`${inputBaseClass} font-mono font-bold tabular-nums tracking-wider select-text ${
                                runError ? 'border-red-500' : 'border-[#E2E8F0] dark:border-[#12151C]'
                            }`}
                        />
                        {runError && (
                            <p className="text-microcopy font-mono text-red-500 mt-fib-8">{runError}</p>
                        )}
                    </div>

                    <div>
                        <label className={labelClass}>Nombre Completo *</label>
                        <input
                            type="text"
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            placeholder="Nombres y apellidos"
                            autoComplete="off"
                            spellCheck={false}
                            className={`${inputBaseClass} border-[#E2E8F0] dark:border-[#12151C]`}
                        />
                    </div>

                    <div>
                        <label className={labelClass}>Email Corporativo *</label>
                        <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="colaborador@empresa.cl"
                            autoComplete="off"
                            spellCheck={false}
                            className={`${inputBaseClass} font-mono select-text ${
                                emailError ? 'border-red-500' : 'border-[#E2E8F0] dark:border-[#12151C]'
                            }`}
                        />
                        {emailError && (
                            <p className="text-microcopy font-mono text-red-500 mt-fib-8">{emailError}</p>
                        )}
                    </div>

                    <div>
                        <label className={labelClass}>Perfil de Cargo Asignado *</label>
                        {profiles.length === 0 ? (
                            <div className="p-fib-21 text-center border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                                <p className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                    [Información técnica no declarada en ficha] — Defina al menos un perfil de cargo antes de vincular personal.
                                </p>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-fib-13">
                                {profiles.map(profile => {
                                    const isSelected = selectedProfileId === profile.id;
                                    return (
                                        <button
                                            key={profile.id}
                                            type="button"
                                            onClick={() => setSelectedProfileId(profile.id)}
                                            data-testid={`profile-card-${profile.name.replace(/\s+/g, '-').toLowerCase()}`}
                                            className={`p-fib-13 rounded-none shadow-none border text-left transition-colors cursor-pointer ${
                                                isSelected
                                                    ? 'bg-[#FFFFFF] dark:bg-[#000000] border-[#C68346]'
                                                    : 'bg-[#FFFFFF] dark:bg-[#000000] border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346]/60'
                                            }`}
                                        >
                                            <div className="flex items-start justify-between gap-fib-8">
                                                <div className="flex items-center gap-fib-8 min-w-0">
                                                    <span className="material-symbols-outlined text-[18px] text-[#C68346] shrink-0">
                                                        badge
                                                    </span>
                                                    <h4 className="text-microcopy font-mono font-bold uppercase truncate text-[#0F172A] dark:text-[#F3F4F6]">
                                                        {profile.name}
                                                    </h4>
                                                </div>
                                                {isSelected && (
                                                    <span className="material-symbols-outlined text-[16px] text-[#00AEEF] shrink-0">
                                                        check_circle
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-microcopy text-[#475569] dark:text-[#8A93A6] mt-fib-8 line-clamp-2 normal-case font-normal">
                                                {profile.description || '[Información técnica no declarada en ficha]'}
                                            </p>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    <div className="pt-fib-8">
                        <button
                            type="submit"
                            disabled={!isFormValid || loading}
                            className="w-full py-fib-13 px-fib-21 bg-[#C68346] hover:bg-[#B0743E] disabled:opacity-40 text-white text-microcopy font-mono font-bold uppercase rounded-none shadow-none cursor-pointer transition-colors"
                        >
                            {loading ? 'VINCULANDO COLABORADOR...' : 'VINCULAR COLABORADOR'}
                        </button>
                    </div>
                </form>

                {/* ÁREA MENOR (38.2%): Protocolo de Activación */}
                <aside className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-21 rounded-none shadow-none space-y-fib-13">
                    <h2 className="text-microcopy font-mono uppercase text-[#C68346]">
                        PROTOCOLO DE PROVISIÓN
                    </h2>
                    <ul className="text-data-dense text-[#475569] dark:text-[#8A93A6] space-y-fib-8 leading-relaxed">
                        <li>1. El colaborador recibe un enlace único de activación en su correo corporativo.</li>
                        <li>2. Hereda estrictamente los módulos autorizados en el perfil de cargo seleccionado.</li>
                        <li>3. Tras activar su credencial, puede registrar una Passkey biométrica FIDO2 para ingreso sin contraseña en terreno.</li>
                    </ul>
                </aside>
            </div>

            {/* MODAL DE CONFIRMACIÓN HITL ("ACTUALIZAR") */}
            {showConfirmModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-fib-21 bg-black/70">
                    <div className="w-full max-w-md bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] p-fib-21 rounded-none shadow-none space-y-fib-21">
                        <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                            <span className="text-microcopy font-mono font-bold uppercase text-[#C68346]">
                                CONFIRMACIÓN HITL REQUERIDA
                            </span>
                            <button
                                type="button"
                                onClick={() => setShowConfirmModal(false)}
                                title="Cerrar"
                                aria-label="Cerrar"
                                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                            >
                                <span className="material-symbols-outlined text-[18px]">close</span>
                            </button>
                        </div>

                        <p className="text-data-dense text-[#475569] dark:text-[#8A93A6] leading-relaxed">
                            Se vinculará a <strong className="text-[#0F172A] dark:text-[#F3F4F6]">{fullName}</strong> (<span className="font-mono tabular-nums">{run}</span>) a la cuenta activa. Escriba <strong className="font-mono text-[#C68346]">ACTUALIZAR</strong> para confirmar:
                        </p>

                        <input
                            type="text"
                            autoFocus
                            autoComplete="off"
                            spellCheck={false}
                            value={confirmKeyword}
                            onChange={(e) => setConfirmKeyword(e.target.value.toUpperCase())}
                            placeholder="ACTUALIZAR"
                            className="w-full px-fib-13 py-fib-8 bg-[#F8FAFC] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] focus:border-[#C68346] text-data-dense font-mono font-bold text-center tracking-widest text-[#0F172A] dark:text-[#F3F4F6] rounded-none shadow-none outline-none"
                        />

                        <div className="flex justify-end gap-fib-8">
                            <button
                                type="button"
                                onClick={() => setShowConfirmModal(false)}
                                className="px-fib-13 py-fib-8 border border-[#E2E8F0] dark:border-[#12151C] bg-transparent text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] rounded-none cursor-pointer"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={handleConfirmedRecruit}
                                disabled={confirmKeyword !== 'ACTUALIZAR' || loading}
                                className="px-fib-21 py-fib-8 bg-[#C68346] hover:bg-[#B0743E] disabled:opacity-30 text-white text-microcopy font-mono font-bold uppercase rounded-none shadow-none cursor-pointer transition-colors"
                            >
                                Confirmar Alta
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default StaffOnboarding;
