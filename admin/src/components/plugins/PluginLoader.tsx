import React, { useEffect, useState } from 'react';
import { PluginManifest, PluginProps } from '../../types/Plugin';
import ErrorBoundary from '../common/ErrorBoundary';

interface PluginLoaderProps {
    plugin: PluginManifest;
    hostProps: PluginProps;
}

/**
 * PluginLoader: Core engine to load external scripts and prepare a secure container.
 */
export const PluginLoader: React.FC<PluginLoaderProps> = ({ plugin, hostProps }) => {
    const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');

    useEffect(() => {
        setStatus('loading');

        // Create script tag
        const script = document.createElement('script');
        script.src = plugin.entryUrl;
        script.async = true;
        script.id = `plugin-script-${plugin.id}`;

        const handleLoad = () => {
            console.log(`Plugin [${plugin.name}] loaded successfully.`);
            setStatus('ready');

            // Attempt to initialize the plugin if it exposed a global init function
            // Convention: window.MINREPORT_PLUGINS[id].init(container, props)
            const win = window as any;
            if (win.MINREPORT_PLUGINS?.[plugin.id]?.init) {
                const container = document.getElementById(`plugin-container-${plugin.id}`);
                if (container) {
                    win.MINREPORT_PLUGINS[plugin.id].init(container, hostProps);
                }
            }
        };

        const handleError = () => {
            console.error(`Failed to load plugin: ${plugin.name} from ${plugin.entryUrl}`);
            setStatus('error');
        };

        script.addEventListener('load', handleLoad);
        script.addEventListener('error', handleError);

        document.body.appendChild(script);

        // Cleanup on unmount
        return () => {
            script.removeEventListener('load', handleLoad);
            script.removeEventListener('error', handleError);
            document.body.removeChild(script);

            // Cleanup plugin global registration if possible
            const win = window as any;
            if (win.MINREPORT_PLUGINS?.[plugin.id]?.destroy) {
                win.MINREPORT_PLUGINS[plugin.id].destroy();
            }
        };
    }, [plugin, hostProps]);

    return (
        <ErrorBoundary
            onReset={() => window.location.reload()}
            fallback={
                <div className="p-6 border-2 border-dashed border-red-200 rounded-xl text-center">
                    <span className="material-symbols-rounded text-red-500 text-4xl mb-2">extension_off</span>
                    <p className="text-red-600 font-medium">No se pudo cargar el plugin {plugin.name}</p>
                </div>
            }
        >
            <div className="relative min-h-[200px] w-full">
                {status === 'loading' && (
                    <div className="absolute inset-0 flex items-center justify-center bg-surface-light/50 dark:bg-surface-dark/50 backdrop-blur-sm z-10 transition-all">
                        <div className="flex flex-col items-center gap-3">
                            <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
                            <span className="text-sm font-medium opacity-70">Cargando {plugin.name}...</span>
                        </div>
                    </div>
                )}

                {status === 'error' && (
                    <div className="p-8 text-center bg-red-50 dark:bg-red-900/10 rounded-xl">
                        <span className="material-symbols-rounded text-3xl text-red-500 mb-2">error</span>
                        <h4 className="font-bold">Error de Conexión</h4>
                        <p className="text-sm opacity-70">No pudimos descargar el archivo del plugin.</p>
                    </div>
                )}

                <div
                    id={`plugin-container-${plugin.id}`}
                    className="w-full h-full min-h-[inherit]"
                />
            </div>
        </ErrorBoundary>
    );
};

export default PluginLoader;
