import { useState, useEffect } from 'react';
import { Plus, Save, Trash2, AlertCircle } from 'lucide-react';
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
 * 
 * Diseño: Split-view con lista de perfiles a la izquierda y editor a la derecha.
 * Estilo: Material Design 3 con tipografía Atkinson Hyperlegible.
 */

export const JobProfileManager = () => {
    const { currentAccount } = useAuth();
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

    // Cargar perfiles en tiempo real
    useEffect(() => {
        if (!currentAccount?.id) return;

        const unsubscribe = ProfileService.getProfiles(currentAccount.id, (loadedProfiles) => {
            setProfiles(loadedProfiles);
        });

        return () => unsubscribe();
    }, [currentAccount?.id]);

    // Sincronizar formulario con perfil seleccionado
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
        if (!currentAccount?.id || !formName.trim()) return;

        setIsSaving(true);
        try {
            const profileData: Partial<JobProfile> = {
                id: selectedProfile?.id,
                name: formName.trim(),
                description: formDescription.trim(),
                allowedPlugins: formPlugins,
                createdAt: selectedProfile?.createdAt,
                createdBy: selectedProfile?.createdBy
            };

            await ProfileService.saveProfile(currentAccount.id, profileData);
            setIsEditing(false);
        } catch (error) {
            console.error('Error saving profile:', error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDelete = async () => {
        if (!currentAccount?.id || !selectedProfile?.id) return;

        if (!confirm(`¿Eliminar el perfil "${selectedProfile.name}"?`)) return;

        try {
            await ProfileService.deleteProfile(currentAccount.id, selectedProfile.id);
            setSelectedProfile(null);
            setIsEditing(false);
        } catch (error) {
            console.error('Error deleting profile:', error);
        }
    };

    if (!currentAccount) {
        return (
            <div className="flex items-center justify-center h-full">
                <p className="text-gray-500 dark:text-gray-400">
                    Selecciona una cuenta para gestionar perfiles
                </p>
            </div>
        );
    }

    return (
        <div
            className="h-full flex gap-6 p-6"
            style={{ fontFamily: "'Atkinson Hyperlegible', sans-serif" }}
        >
            {/* LISTA DE PERFILES - Izquierda */}
            <aside className="w-80 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-gray-900 dark:text-white">
                        Perfiles de Cargo
                    </h2>
                    <Button
                        variant="primary"
                        icon="add"
                        onClick={handleNewProfile}
                        className="!px-3 !py-2"
                    >
                        Nuevo
                    </Button>
                </div>

                <div className="flex-1 overflow-y-auto space-y-2">
                    {profiles.length === 0 ? (
                        <Card className="!p-8 text-center">
                            <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                                <span className="material-symbols-rounded text-gray-400 dark:text-gray-600">
                                    badge
                                </span>
                            </div>
                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                No hay perfiles creados
                            </p>
                            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                                Crea tu primer perfil de cargo
                            </p>
                        </Card>
                    ) : (
                        profiles.map(profile => (
                            <button
                                key={profile.id}
                                onClick={() => handleSelectProfile(profile)}
                                className={`
                                    w-full text-left p-4 rounded-lg border transition-all
                                    ${selectedProfile?.id === profile.id
                                        ? 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-500'
                                        : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:border-indigo-300 dark:hover:border-indigo-700'
                                    }
                                `}
                            >
                                <div className="flex items-start gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
                                        <span className="material-symbols-rounded text-indigo-600 dark:text-indigo-400 text-xl">
                                            badge
                                        </span>
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <h3 className="font-semibold text-gray-900 dark:text-white truncate">
                                            {profile.name}
                                        </h3>
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
                        ))
                    )}
                </div>
            </aside>

            {/* EDITOR DE PERFIL - Derecha */}
            <main className="flex-1 flex flex-col gap-4">
                {!selectedProfile && !isEditing ? (
                    <Card className="flex-1 flex flex-col items-center justify-center !p-12 text-center">
                        <div className="w-20 h-20 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center mb-4">
                            <span className="material-symbols-rounded text-4xl text-gray-400 dark:text-gray-600">
                                badge
                            </span>
                        </div>
                        <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                            Selecciona un perfil
                        </h3>
                        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md">
                            Elige un perfil de la lista o crea uno nuevo para definir
                            qué herramientas puede usar cada cargo en tu empresa.
                        </p>
                    </Card>
                ) : (
                    <>
                        {/* Header del Editor */}
                        <Card className="!p-4">
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 rounded-xl bg-indigo-100 dark:bg-indigo-500/20 flex items-center justify-center">
                                        <span className="material-symbols-rounded text-indigo-600 dark:text-indigo-400 text-2xl">
                                            badge
                                        </span>
                                    </div>
                                    <div>
                                        <h2 className="text-lg font-bold text-gray-900 dark:text-white">
                                            {isEditing ? (selectedProfile ? 'Editar Perfil' : 'Nuevo Perfil') : selectedProfile?.name}
                                        </h2>
                                        <p className="text-xs text-gray-500 dark:text-gray-400">
                                            {isEditing ? 'Define permisos de plugins' : 'Vista de perfil'}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {!isEditing ? (
                                        <>
                                            <Button
                                                variant="secondary"
                                                icon="edit"
                                                onClick={() => setIsEditing(true)}
                                            >
                                                Editar
                                            </Button>
                                            <Button
                                                variant="secondary"
                                                icon="delete"
                                                onClick={handleDelete}
                                                className="!text-red-600 dark:!text-red-400 hover:!bg-red-50 dark:hover:!bg-red-900/20"
                                            >
                                                Eliminar
                                            </Button>
                                        </>
                                    ) : (
                                        <>
                                            <Button
                                                variant="secondary"
                                                onClick={() => {
                                                    setIsEditing(false);
                                                    if (selectedProfile) {
                                                        setFormName(selectedProfile.name);
                                                        setFormDescription(selectedProfile.description);
                                                        setFormPlugins(selectedProfile.allowedPlugins || []);
                                                    }
                                                }}
                                            >
                                                Cancelar
                                            </Button>
                                            <Button
                                                variant="primary"
                                                icon="save"
                                                onClick={handleSave}
                                                disabled={isSaving || !formName.trim()}
                                            >
                                                {isSaving ? 'Guardando...' : 'Guardar'}
                                            </Button>
                                        </>
                                    )}
                                </div>
                            </div>
                        </Card>

                        {/* Formulario */}
                        <Card className="flex-1 overflow-y-auto">
                            <div className="space-y-6">
                                {/* Nombre del Perfil */}
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                        Nombre del Perfil
                                    </label>
                                    <input
                                        type="text"
                                        value={formName}
                                        onChange={(e) => setFormName(e.target.value)}
                                        disabled={!isEditing}
                                        placeholder="ej: Operador CAEX, Supervisor de Planta"
                                        className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
                                    />
                                </div>

                                {/* Descripción */}
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                        Descripción
                                    </label>
                                    <textarea
                                        value={formDescription}
                                        onChange={(e) => setFormDescription(e.target.value)}
                                        disabled={!isEditing}
                                        placeholder="Describe las responsabilidades de este cargo..."
                                        rows={3}
                                        className="w-full px-4 py-3 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed transition-all resize-none"
                                    />
                                </div>

                                {/* Grid de Plugins */}
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
                                        Herramientas Permitidas
                                    </label>

                                    {availablePlugins.length === 0 ? (
                                        <div className="p-8 text-center bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700">
                                            <AlertCircle className="w-12 h-12 mx-auto mb-3 text-gray-400" />
                                            <p className="text-sm text-gray-500 dark:text-gray-400">
                                                No hay plugins disponibles
                                            </p>
                                        </div>
                                    ) : (
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            {availablePlugins.map(plugin => {
                                                const isEnabled = formPlugins.includes(plugin.id);

                                                return (
                                                    <div
                                                        key={plugin.id}
                                                        className={`
                                                            p-4 rounded-lg border transition-all
                                                            ${isEnabled
                                                                ? 'bg-indigo-50 dark:bg-indigo-500/10 border-indigo-500'
                                                                : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'
                                                            }
                                                            ${isEditing ? 'cursor-pointer hover:border-indigo-300 dark:hover:border-indigo-700' : 'opacity-60'}
                                                        `}
                                                        onClick={() => isEditing && handleTogglePlugin(plugin.id)}
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <div className="flex items-center gap-3 flex-1 min-w-0">
                                                                <div className={`
                                                                    w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0
                                                                    ${isEnabled
                                                                        ? 'bg-indigo-100 dark:bg-indigo-500/20'
                                                                        : 'bg-gray-100 dark:bg-gray-700'
                                                                    }
                                                                `}>
                                                                    <span className={`
                                                                        material-symbols-rounded text-xl
                                                                        ${isEnabled
                                                                            ? 'text-indigo-600 dark:text-indigo-400'
                                                                            : 'text-gray-500 dark:text-gray-400'
                                                                        }
                                                                    `}>
                                                                        {plugin.icon || 'extension'}
                                                                    </span>
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <h4 className="font-semibold text-sm text-gray-900 dark:text-white truncate">
                                                                        {plugin.name}
                                                                    </h4>
                                                                    <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                                                        v{plugin.version}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                            <M3Switch
                                                                checked={isEnabled}
                                                                onChange={() => isEditing && handleTogglePlugin(plugin.id)}
                                                                disabled={!isEditing}
                                                            />
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}
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
