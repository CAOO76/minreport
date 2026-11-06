import React, { useState, useEffect } from 'react';
import { ProfileService } from '../../services/ProfileService';
import { SYSTEM_MODULES } from '../../constants/modules';
import { useAuth } from '../../context/AuthContext';
import type { JobProfile } from '../../types/job_profile';
import M3Switch from '../common/M3Switch';

export const JobProfileManager: React.FC = () => {
    const { currentAccount, user } = useAuth();
    const [profiles, setProfiles] = useState<JobProfile[]>([]);
    const [selectedProfile, setSelectedProfile] = useState<JobProfile | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const [formName, setFormName] = useState('');
    const [formDescription, setFormDescription] = useState('');
    const [formPlugins, setFormPlugins] = useState<string[]>([]);

    // Modal HITL ("ACTUALIZAR") para Guardar o Eliminar
    const [confirmAction, setConfirmAction] = useState<'save' | 'delete' | null>(null);
    const [confirmKeyword, setConfirmKeyword] = useState('');

    const availableModules = SYSTEM_MODULES;

    useEffect(() => {
        if (!currentAccount?.id) return;
        const unsubscribe = ProfileService.getProfiles(currentAccount.id, (loadedProfiles) => {
            setProfiles(loadedProfiles);
        });
        return () => unsubscribe();
    }, [currentAccount?.id]);

    useEffect(() => {
        if (selectedProfile) {
            setFormName(selectedProfile.name);
            setFormDescription(selectedProfile.description);
            setFormPlugins(selectedProfile.allowedPlugins || []);
        }
    }, [selectedProfile]);

    const handleNewProfile = () => {
        setSelectedProfile(null);
        setFormName('');
        setFormDescription('');
        setFormPlugins([]);
        setIsEditing(true);
    };

    const handleSelectProfile = (profile: JobProfile) => {
        setSelectedProfile(profile);
        setIsEditing(false);
    };

    const handleTogglePlugin = (pluginId: string) => {
        setFormPlugins(prev =>
            prev.includes(pluginId)
                ? prev.filter(id => id !== pluginId)
                : [...prev, pluginId]
        );
    };

    const openHitlConfirm = (action: 'save' | 'delete') => {
        setConfirmKeyword('');
        setConfirmAction(action);
    };

    const handleExecuteConfirmed = async () => {
        if (confirmKeyword !== 'ACTUALIZAR') return;
        if (!currentAccount?.id) return;

        if (confirmAction === 'save') {
            if (!user?.uid || !formName.trim()) return;
            setIsSaving(true);
            setConfirmAction(null);
            try {
                const profileData: Partial<JobProfile> = {
                    id: selectedProfile?.id,
                    name: formName.trim(),
                    description: formDescription.trim(),
                    allowedPlugins: formPlugins,
                    createdBy: selectedProfile?.createdBy || user.uid,
                };
                await ProfileService.saveProfile(currentAccount.id, profileData);
                setIsEditing(false);
                setConfirmKeyword('');
            } finally {
                setIsSaving(false);
            }
        } else if (confirmAction === 'delete' && selectedProfile) {
            setIsSaving(true);
            setConfirmAction(null);
            try {
                await ProfileService.deleteProfile(currentAccount.id, selectedProfile.id);
                setSelectedProfile(null);
                setIsEditing(false);
                setConfirmKeyword('');
            } finally {
                setIsSaving(false);
            }
        }
    };

    if (!currentAccount?.id) {
        return (
            <div className="flex items-center justify-center p-fib-34 h-64 font-mono text-data-dense text-[#94A3B8] dark:text-[#5A6072]">
                [Cargando perfiles de cargo...]
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto py-fib-34 px-fib-21 font-sans select-none bg-[#FFFFFF] dark:bg-[#000000] text-[#0F172A] dark:text-[#F3F4F6]">
            {/* Macro-Layout Proporción Áurea: 38.2% Lista de Perfiles / 61.8% Ficha o Edición */}
            <div className="grid grid-cols-1 lg:grid-cols-[38.2fr_61.8fr] gap-fib-21 items-start">
                {/* ÁREA MENOR (38.2%): LISTA DE PERFILES */}
                <aside className="bg-[#F8FAFC] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] p-fib-21 rounded-none shadow-none space-y-fib-21">
                    <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                        <h2
                            className="text-microcopy font-mono font-bold uppercase text-[#C68346]"
                            data-testid="page-title"
                        >
                            Perfiles de Cargo ({profiles.length})
                        </h2>
                        <button
                            type="button"
                            onClick={handleNewProfile}
                            data-testid="add-profile-btn"
                            className="px-fib-13 py-fib-8 bg-[#C68346] hover:bg-[#B0743E] text-white text-microcopy font-mono font-bold uppercase rounded-none shadow-none cursor-pointer transition-colors"
                        >
                            Nuevo Perfil
                        </button>
                    </div>

                    <div className="space-y-fib-8 max-h-[520px] overflow-y-auto">
                        {profiles.map(profile => {
                            const active = selectedProfile?.id === profile.id;
                            return (
                                <button
                                    key={profile.id}
                                    type="button"
                                    onClick={() => handleSelectProfile(profile)}
                                    data-testid="profile-item"
                                    className={`w-full text-left p-fib-13 rounded-none shadow-none border transition-colors cursor-pointer ${
                                        active
                                            ? 'bg-[#FFFFFF] dark:bg-[#000000] border-[#C68346]'
                                            : 'bg-[#FFFFFF] dark:bg-[#000000] border-[#E2E8F0] dark:border-[#12151C] hover:border-[#C68346]/60'
                                    }`}
                                >
                                    <div className="flex items-center justify-between gap-fib-8">
                                        <h3 className="text-data-dense font-bold uppercase truncate text-[#0F172A] dark:text-[#F3F4F6]">
                                            {profile.name}
                                        </h3>
                                        <span className="text-microcopy font-mono tabular-nums text-[#00AEEF]">
                                            {(profile.allowedPlugins || []).length} mód.
                                        </span>
                                    </div>
                                    <p className="text-microcopy text-[#475569] dark:text-[#8A93A6] line-clamp-2 mt-fib-8 normal-case font-normal">
                                        {profile.description || '[Información técnica no declarada en ficha]'}
                                    </p>
                                </button>
                            );
                        })}

                        {profiles.length === 0 && (
                            <div className="p-fib-21 text-center border border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000]">
                                <p className="text-data-dense font-mono text-[#94A3B8] dark:text-[#5A6072]">
                                    [Información técnica no declarada en ficha]
                                </p>
                            </div>
                        )}
                    </div>
                </aside>

                {/* ÁREA MAYOR (61.8%): VISOR TÉCNICO / EDITOR QUIRÚRGICO */}
                <main className="min-w-0">
                    {!selectedProfile && !isEditing ? (
                        <div className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] p-fib-55 text-center rounded-none shadow-none space-y-fib-13">
                            <span className="material-symbols-outlined text-[32px] text-[#C68346] block">badge</span>
                            <h3 className="text-h2-section font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6]">
                                Seleccione o cree un perfil de cargo
                            </h3>
                            <p className="text-data-dense text-[#475569] dark:text-[#8A93A6] max-w-md mx-auto">
                                Defina los permisos modulares asignados a cada rol operativo o administrativo dentro de la cuenta.
                            </p>
                        </div>
                    ) : (
                        <form
                            onSubmit={(e) => {
                                e.preventDefault();
                                if (isEditing && formName.trim()) openHitlConfirm('save');
                            }}
                            autoComplete="off"
                            spellCheck={false}
                            className="border border-[#E2E8F0] dark:border-[#12151C] bg-[#F8FAFC] dark:bg-[#07090D] rounded-none shadow-none"
                        >
                            {/* Cabecera de Ficha */}
                            <div className="px-fib-21 py-fib-13 border-b border-[#E2E8F0] dark:border-[#12151C] bg-[#FFFFFF] dark:bg-[#000000] flex items-center justify-between gap-fib-13">
                                <h2 className="text-h2-section font-bold uppercase text-[#0F172A] dark:text-[#F3F4F6] truncate">
                                    {isEditing ? (selectedProfile ? 'Editar Perfil de Cargo' : 'Nuevo Perfil de Cargo') : selectedProfile?.name}
                                </h2>

                                <div className="flex items-center gap-fib-8">
                                    {!isEditing ? (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => setIsEditing(true)}
                                                title="Editar perfil"
                                                aria-label="Editar perfil"
                                                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors cursor-pointer"
                                            >
                                                <span className="material-symbols-outlined text-[20px]">edit</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => openHitlConfirm('delete')}
                                                title="Eliminar perfil"
                                                aria-label="Eliminar perfil"
                                                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-red-500 transition-colors cursor-pointer"
                                            >
                                                <span className="material-symbols-outlined text-[20px]">delete</span>
                                            </button>
                                        </>
                                    ) : (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (selectedProfile) {
                                                        setFormName(selectedProfile.name);
                                                        setFormDescription(selectedProfile.description);
                                                        setFormPlugins(selectedProfile.allowedPlugins || []);
                                                    }
                                                    setIsEditing(false);
                                                }}
                                                className="px-fib-13 py-fib-8 border border-[#E2E8F0] dark:border-[#12151C] bg-transparent text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] hover:text-[#0F172A] dark:hover:text-white rounded-none shadow-none cursor-pointer"
                                            >
                                                Cancelar
                                            </button>
                                            <button
                                                type="submit"
                                                disabled={isSaving || !formName.trim()}
                                                data-testid="save-profile-btn"
                                                className="px-fib-21 py-fib-8 bg-[#C68346] hover:bg-[#B0743E] disabled:opacity-40 text-white text-microcopy font-mono font-bold uppercase rounded-none shadow-none cursor-pointer transition-colors"
                                            >
                                                {isSaving ? 'Guardando...' : 'Guardar'}
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>

                            {/* Cuerpo Técnico */}
                            <div className="p-fib-21 space-y-fib-21">
                                <div>
                                    <label className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] mb-fib-8">
                                        Nombre del Perfil *
                                    </label>
                                    <input
                                        type="text"
                                        value={formName}
                                        onChange={(e) => setFormName(e.target.value)}
                                        disabled={!isEditing}
                                        placeholder="Ej. Operador CAEX"
                                        autoComplete="off"
                                        spellCheck={false}
                                        data-testid="profile-name-input"
                                        className="w-full px-fib-13 py-fib-8 rounded-none shadow-none bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] text-data-dense text-[#0F172A] dark:text-[#F3F4F6] font-bold focus:outline-none focus:border-[#C68346] disabled:opacity-60"
                                    />
                                </div>

                                <div>
                                    <label className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] mb-fib-8">
                                        Alcance y Responsabilidades
                                    </label>
                                    <textarea
                                        value={formDescription}
                                        onChange={(e) => setFormDescription(e.target.value)}
                                        disabled={!isEditing}
                                        placeholder="Descripción técnica del cargo..."
                                        autoComplete="off"
                                        spellCheck={false}
                                        data-testid="profile-description-textarea"
                                        className="w-full p-fib-13 rounded-none shadow-none bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] text-data-dense text-[#0F172A] dark:text-[#F3F4F6] resize-none h-28 focus:outline-none focus:border-[#C68346] disabled:opacity-60"
                                    />
                                </div>

                                <div>
                                    <label className="block text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] mb-fib-13">
                                        Módulos Operativos Autorizados
                                    </label>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-fib-13">
                                        {availableModules.map(mod => (
                                            <div
                                                key={mod.id}
                                                className="p-fib-13 rounded-none shadow-none bg-[#FFFFFF] dark:bg-[#000000] border border-[#E2E8F0] dark:border-[#12151C] flex items-center justify-between gap-fib-13"
                                            >
                                                <div className="flex items-center gap-fib-13">
                                                    <span className="material-symbols-outlined text-[20px] text-[#C68346]">
                                                        {mod.icon}
                                                    </span>
                                                    <div>
                                                        <p className="text-data-dense font-bold text-[#0F172A] dark:text-[#F3F4F6]">
                                                            {mod.name}
                                                        </p>
                                                        <p className="text-microcopy font-mono tabular-nums text-[#475569] dark:text-[#8A93A6]">
                                                            v{mod.version}
                                                        </p>
                                                    </div>
                                                </div>
                                                <M3Switch
                                                    checked={formPlugins.includes(mod.id)}
                                                    onChange={() => isEditing && handleTogglePlugin(mod.id)}
                                                    data-testid={`plugin-switch-${mod.id}`}
                                                    disabled={!isEditing}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </form>
                    )}
                </main>
            </div>

            {/* MODAL DE CONFIRMACIÓN HITL ("ACTUALIZAR") */}
            {confirmAction && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-fib-21 bg-black/70">
                    <div className="w-full max-w-md bg-[#FFFFFF] dark:bg-[#07090D] border border-[#E2E8F0] dark:border-[#12151C] p-fib-21 rounded-none shadow-none space-y-fib-21">
                        <div className="flex items-center justify-between border-b border-[#E2E8F0] dark:border-[#12151C] pb-fib-13">
                            <span className="text-microcopy font-mono font-bold uppercase text-[#C68346]">
                                {confirmAction === 'delete' ? 'CONFIRMAR ELIMINACIÓN DE PERFIL' : 'CONFIRMAR GUARDADO DE PERFIL'}
                            </span>
                            <button
                                type="button"
                                onClick={() => setConfirmAction(null)}
                                title="Cerrar"
                                aria-label="Cerrar"
                                className="bg-transparent border-0 outline-none p-1 text-slate-400 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                            >
                                <span className="material-symbols-outlined text-[18px]">close</span>
                            </button>
                        </div>

                        <p className="text-data-dense text-[#475569] dark:text-[#8A93A6] leading-relaxed">
                            {confirmAction === 'delete'
                                ? `Se eliminará el perfil de cargo "${selectedProfile?.name}".`
                                : `Se actualizará la definición de permisos del perfil "${formName}".`}{' '}
                            Escriba obligatoriamente <strong className="font-mono text-[#C68346]">ACTUALIZAR</strong> para continuar:
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
                                onClick={() => setConfirmAction(null)}
                                className="px-fib-13 py-fib-8 border border-[#E2E8F0] dark:border-[#12151C] bg-transparent text-microcopy font-mono uppercase text-[#475569] dark:text-[#8A93A6] rounded-none cursor-pointer"
                            >
                                Cancelar
                            </button>
                            <button
                                type="button"
                                onClick={handleExecuteConfirmed}
                                disabled={confirmKeyword !== 'ACTUALIZAR' || isSaving}
                                className={`px-fib-21 py-fib-8 text-microcopy font-mono font-bold uppercase text-white disabled:opacity-30 rounded-none shadow-none cursor-pointer transition-colors ${
                                    confirmAction === 'delete' ? 'bg-red-600 hover:bg-red-700' : 'bg-[#C68346] hover:bg-[#B0743E]'
                                }`}
                            >
                                Confirmar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default JobProfileManager;
