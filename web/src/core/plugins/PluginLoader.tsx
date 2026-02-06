import { useEffect, useState, useMemo } from 'react';
import { PluginErrorBoundary } from './PluginErrorBoundary';
import { getPluginById } from '../PluginRegistry';
import { useAuth } from '../../context/AuthContext';

/**
 * PluginLoader
 * 
 * Este componente es el encargado de buscar, inicializar y renderizar un plugin.
 * Actúa como un contenedor seguro que garantiza que el plugin tenga su contexto
 * y que cualquier fallo sea capturado por el Muro de Contención.
 */

interface PluginLoaderProps {
    pluginId: string;
}

export const PluginLoader: React.FC<PluginLoaderProps> = ({ pluginId }) => {
    const { user, currentAccount } = useAuth();
    const [isInitialized, setIsInitialized] = useState(false);

    // Buscar el plugin en el registro
    const pluginEntry = useMemo(() => getPluginById(pluginId), [pluginId]);

    useEffect(() => {
        const initPlugin = async () => {
            if (pluginEntry && user && currentAccount && !isInitialized) {
                try {
                    // Preparar contexto del sistema para el plugin
                    const context = {
                        projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'minreport-demo',
                        userId: user.uid,
                        isOffline: !navigator.onLine,
                        // Datos extendidos que el Core Web puede proporcionar
                        accountId: currentAccount.id
                    };

                    // Ejecutar ciclo de vida de inicialización
                    await pluginEntry.instance.onInit(context as any);
                    setIsInitialized(true);
                } catch (error) {
                    console.error(`[PluginLoader] Error inicializando plugin "${pluginId}":`, error);
                }
            }
        };

        initPlugin();
    }, [pluginEntry, user, currentAccount, isInitialized, pluginId]);

    // Manejo de Estado 404: Plugin no encontrado
    if (!pluginEntry) {
        return (
            <div
                style={{ fontFamily: "'Atkinson Hyperlegible', sans-serif" }}
                className="p-10 bg-slate-50 dark:bg-zinc-900/20 border-2 border-dashed border-slate-200 dark:border-zinc-800 rounded-[32px] flex flex-col items-center justify-center gap-4 text-center"
            >
                <div className="w-12 h-12 rounded-full bg-slate-100 dark:bg-zinc-800 flex items-center justify-center">
                    <span className="material-symbols-rounded text-slate-400 dark:text-zinc-600">
                        search_off
                    </span>
                </div>
                <div className="space-y-1">
                    <h4 className="font-bold text-slate-900 dark:text-zinc-100">
                        Plugin no disponible
                    </h4>
                    <p className="text-sm text-slate-500 dark:text-zinc-400 max-w-[200px]">
                        El ID "{pluginId}" no está registrado o no tienes permisos para usarlo.
                    </p>
                </div>
            </div>
        );
    }

    // Renderizado Seguro
    return (
        <PluginErrorBoundary pluginName={pluginEntry.manifest.name}>
            <div id="plugin-canvas" className="w-full h-full animate-in fade-in zoom-in-95 duration-700">
                {/* Renderizado dinámico del widget del plugin */}
                {pluginEntry.instance.renderWidget()}
            </div>
        </PluginErrorBoundary>
    );
};

export default PluginLoader;
