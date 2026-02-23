import { useState, useEffect } from 'react';
import { ChevronRight, AlertCircle, Info } from 'lucide-react';
import { ProfileService } from '../../services/ProfileService';
import { getAllPlugins } from '../../core/PluginRegistry';
import { useAuth } from '../../context/AuthContext';
import type { JobProfile } from '../../types/job_profile';
import { Button } from '../Button';
import { Card } from '../Card';
import M3Switch from '../common/M3Switch';

/**
 * JobProfileManager
 * 
 * Panel de administración para gestionar Perfiles de Cargo (Job Profiles).
 * Permite a las empresas B2B crear perfiles estandarizados con conjuntos
 * específicos de plugins asignados.
 */

export const JobProfileManager = () => {
    const { currentAccount, user } = useAuth();
    const [profiles, setProfiles] = useState<JobProfile[]>([]);
    const [selectedProfile, setSelectedProfile] = useState<JobProfile | null>(null);
    const [isEditing, setIsEditing] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    // Form state
    const [formName, setFormName] = useState('');
    const [formDescription, setFormDescription] = useState('');
    const [formPlugins, setFormPlugins] = useState<string[]>([]);

    // Obtener plugins disponibles
    const availablePlugins = getAllPlugins();

    // Cargar perfiles
    useEffect(() => {
        if (!currentAccount?.id) return;

        const unsubscribe = ProfileService.getProfiles(currentAccount.id, (loadedProfiles) => {
            console.log(`[JobProfileManager] Perfiles cargados: ${loadedProfiles.length}`);
            setProfiles(loadedProfiles);
        });

        return () => unsubscribe();
    }, [currentAccount?.id]);

    // Sincronizar formulario
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

    const handleSave = async () => {
        if (!user?.uid) {
            console.error('[JobProfileManager] Error: No user UID found');
            return;
        }
        if (!currentAccount?.id || !formName.trim()) return;

        setIsSaving(true);
        try {
            const profileData: Partial<JobProfile> = {
                id: selectedProfile?.id,
                name: formName.trim(),
                description: formDescription.trim(),
                allowedPlugins: formPlugins,
                createdBy: selectedProfile?.createdBy || user.uid
            };

            await ProfileService.saveProfile(currentAccount.id, profileData);
            setIsEditing(false);
        } catch (error) {
            console.error('Error saving profile:', error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteProfile = async () => {
        if (!selectedProfile || !currentAccount?.id) return;
        const confirmed = window.confirm(`¿Eliminar el perfil "${selectedProfile.name}"?`);
        if (!confirmed) return;

        try {
            await ProfileService.deleteProfile(currentAccount.id, selectedProfile.id);
            setSelectedProfile(null);
            setIsEditing(false);
        } catch (error) {
            console.error('Error deleting profile:', error);
        }
    };

    if (!currentAccount?.id) {
        return (
            <div className="flex items-center justify-center p-12 h-64">
                <div className="text-center animate-pulse">
                    <AlertCircle className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                    <p className="text-sm text-gray-500">Cargando perfiles...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full flex flex-col md:flex-row gap-6 p-6" style={{ fontFamily: "'Atkinson Hyperlegible', sans-serif" }}>
            {/* LISTA DE PERFILES */}
            <aside className="w-full md:w-80 flex flex-col gap-4">
                <div className="flex items-center justify-between mb-6">
                    <h2 className="hud-label text-black dark:text-white" data-testid="page-title">
                        [LISTA_PERFILES]
                    </h2>
                    <Button
                        variant="primary"
                        icon="add"
                        onClick={handleNewProfile}
                        className="!p-2 !rounded-none"
                        data-testid="add-profile-btn"
                    >
                        NEW_ROLE
                    </Button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2">
                    {profiles.map(profile => (
                        <button
                            key={profile.id}
                            onClick={() => handleSelectProfile(profile)}
                            className={`w-full text-left p-5 rounded-none border transition-all ${selectedProfile?.id === profile.id
                                ? 'bg-black dark:bg-white text-white dark:text-black border-transparent'
                                : 'bg-black/5 dark:bg-white/5 border-black/10 dark:border-white/10 hover:border-black/30'
                                }`}
                            data-testid="profile-item"
                        >
                            <h3 className={`font-black text-[11px] uppercase tracking-widest truncate ${selectedProfile?.id === profile.id ? 'text-white dark:text-black' : 'text-black dark:text-white'}`}>{profile.name}</h3>
                            <p className={`text-[10px] line-clamp-2 mt-1 ${selectedProfile?.id === profile.id ? 'text-white/60 dark:text-black/60' : 'text-black/40 dark:text-white/40'}`}>{profile.description}</p>
                        </button>
                    ))}
                    {profiles.length === 0 && (
                        <div className="p-8 text-center bg-black/5 dark:bg-white/5 rounded-none border border-black/10 dark:border-white/10">
                            <p className="hud-label text-[10px] text-black/40 dark:text-white/40">NO_PROFILES_FOUND</p>
                        </div>
                    )}
                </div>
            </aside>

            {/* EDITOR */}
            <main className="flex-1 flex flex-col gap-4 min-w-0">
                {!selectedProfile && !isEditing ? (
                    <Card className="flex-1 flex flex-col items-center justify-center !p-12 text-center">
                        <Info className="w-12 h-12 text-gray-300 mb-4" />
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">Selecciona un perfil</h3>
                        <p className="text-sm text-gray-500 max-w-sm">Define las herramientas permitidas para cada cargo administrativo u operativo.</p>
                    </Card>
                ) : (
                    <>
                        <Card className="!p-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-none bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 flex items-center justify-center">
                                        <ChevronRight className="text-black/40 dark:text-white/40" />
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-black uppercase tracking-tight text-gray-900 dark:text-white">
                                            {isEditing ? (selectedProfile ? 'MOD_PROFILE' : 'INIT_PROFILE') : selectedProfile?.name}
                                        </h2>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {!isEditing ? (
                                        <>
                                            <Button variant="secondary" icon="edit" onClick={() => setIsEditing(true)}>Editar</Button>
                                            <Button variant="secondary" icon="delete" onClick={handleDeleteProfile} className="!text-red-500">Eliminar</Button>
                                        </>
                                    ) : (
                                        <>
                                            <Button variant="secondary" onClick={() => setIsEditing(false)}>Cancelar</Button>
                                            <Button variant="primary" icon="save" onClick={handleSave} disabled={isSaving || !formName.trim()} data-testid="save-profile-btn">
                                                {isSaving ? 'Guardando...' : 'Guardar'}
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </Card>

                        <Card className="flex-1 overflow-y-auto space-y-6">
                            <div>
                                <label className="hud-label text-black/40 dark:text-white/40 mb-3">[01] Nombre del Perfil</label>
                                <input
                                    type="text"
                                    value={formName}
                                    onChange={(e) => setFormName(e.target.value)}
                                    disabled={!isEditing}
                                    placeholder="ej: Operador CAEX"
                                    autoComplete="off"
                                    spellCheck="false"
                                    className="w-full p-4 rounded-none bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-gray-900 dark:text-white font-bold tracking-wide focus:outline-none focus:border-black dark:focus:border-white"
                                    data-testid="profile-name-input"
                                />
                            </div>

                            <div>
                                <label className="hud-label text-black/40 dark:text-white/40 mb-3">[02] Descripción Técnica</label>
                                <textarea
                                    value={formDescription}
                                    onChange={(e) => setFormDescription(e.target.value)}
                                    disabled={!isEditing}
                                    placeholder="Responsabilidades del cargo..."
                                    autoComplete="off"
                                    spellCheck="false"
                                    className="w-full p-4 rounded-none bg-black/5 dark:bg-white/5 border border-black/10 dark:border-white/10 text-gray-900 dark:text-white resize-none font-medium h-32 focus:outline-none focus:border-black dark:focus:border-white"
                                    data-testid="profile-description-textarea"
                                />
                            </div>

                            <div>
                                <label className="hud-label text-black/40 dark:text-white/40 mb-5">[03] CORE_PLUGINS_ACCESS</label>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                    {availablePlugins.map(plugin => (
                                        <div key={plugin.id} className="p-4 rounded-none bg-black/2[bg-black/2] dark:bg-white/5 border border-black/5 dark:border-white/10 flex items-center justify-between">
                                            <div className="flex items-center gap-3">
                                                <div className="w-8 h-8 rounded bg-white dark:bg-gray-700 flex items-center justify-center">
                                                    <span className="material-symbols-rounded text-sm">extension</span>
                                                </div>
                                                <div>
                                                    <p className="text-sm font-medium">{plugin.name}</p>
                                                    <p className="text-xs text-gray-500">v{plugin.version}</p>
                                                </div>
                                            </div>
                                            <M3Switch
                                                checked={formPlugins.includes(plugin.id)}
                                                onChange={() => isEditing && handleTogglePlugin(plugin.id)}
                                                data-testid={`plugin-switch-${plugin.id}`}
                                                disabled={!isEditing}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </Card>
                    </>
                )}
            </main>
        </div>
    );
};

export default JobProfileManager;
